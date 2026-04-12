// @pdt/frontend — entry point with view routing.
//
// Two views: Arena (landing page) and Tournament. A minimal nav bar at
// the top lets the user switch between them. The arena auto-demo
// starts immediately on page load.

import { ENGINE_VERSION } from '@pdt/engine';
import { ApiError, BACKEND_URL, getHealth } from './api.js';
import { mountArena, type ArenaHandle } from './arena/arena-runner.js';
import { mountTournamentRunner } from './views/tournament-runner.js';

const app = document.getElementById('app');
if (!app) {
  throw new Error('main.ts: #app root element missing from index.html');
}

// ---- Full-viewport layout ----
document.body.style.margin = '0';
document.body.style.overflow = 'hidden';
document.body.style.background = '#111';

app.innerHTML = `
  <div id="shell" style="display:flex;flex-direction:column;height:100vh;font-family:system-ui,sans-serif;">
    <nav id="nav" style="display:flex;align-items:center;justify-content:space-between;
                         padding:6px 16px;background:#1a1a2e;color:#ddd;flex-shrink:0;z-index:20;">
      <div style="display:flex;align-items:center;gap:16px;">
        <span style="font-weight:bold;font-size:1rem;">Prisoner's Dilemma</span>
        <button id="tab-arena" style="all:unset;cursor:pointer;padding:4px 12px;border-radius:4px;font-size:0.85rem;">Arena</button>
        <button id="tab-tournament" style="all:unset;cursor:pointer;padding:4px 12px;border-radius:4px;font-size:0.85rem;">Tournament</button>
      </div>
      <div style="display:flex;align-items:center;gap:12px;font-size:0.8rem;color:#888;">
        <span>Engine v${ENGINE_VERSION}</span>
        <span id="health-badge">checking…</span>
      </div>
    </nav>
    <div id="view" style="flex:1;overflow:hidden;position:relative;"></div>
  </div>
`;

const tabArena = document.getElementById('tab-arena') as HTMLButtonElement;
const tabTournament = document.getElementById('tab-tournament') as HTMLButtonElement;
const viewEl = document.getElementById('view')!;
const healthEl = document.getElementById('health-badge')!;

// ---- Tab styling ----
const ACTIVE_TAB_STYLE = 'background:#2f3b6e;color:#fff;';
const INACTIVE_TAB_STYLE = 'background:transparent;color:#999;';

function setActiveTab(tab: 'arena' | 'tournament'): void {
  tabArena.style.cssText = `all:unset;cursor:pointer;padding:4px 12px;border-radius:4px;font-size:0.85rem;${tab === 'arena' ? ACTIVE_TAB_STYLE : INACTIVE_TAB_STYLE}`;
  tabTournament.style.cssText = `all:unset;cursor:pointer;padding:4px 12px;border-radius:4px;font-size:0.85rem;${tab === 'tournament' ? ACTIVE_TAB_STYLE : INACTIVE_TAB_STYLE}`;
}

// ---- View management ----
type View = 'arena' | 'tournament';
let currentView: View | null = null;
let arenaHandle: ArenaHandle | null = null;

async function switchView(target: View): Promise<void> {
  if (target === currentView) return;

  // Teardown current view.
  if (arenaHandle) {
    arenaHandle.destroy();
    arenaHandle = null;
  }
  viewEl.innerHTML = '';

  currentView = target;
  setActiveTab(target);

  if (target === 'arena') {
    arenaHandle = await mountArena(viewEl);
  } else {
    // Tournament view gets a scrollable container with the classic layout.
    const container = document.createElement('div');
    container.style.cssText =
      'max-width:960px;margin:1.5rem auto;padding:0 1rem;overflow-y:auto;height:100%;color:#ddd;';
    viewEl.appendChild(container);
    viewEl.style.overflowY = 'auto';
    await mountTournamentRunner(container);
  }
}

tabArena.addEventListener('click', () => void switchView('arena'));
tabTournament.addEventListener('click', () => void switchView('tournament'));

// ---- Boot ----
void runHealthCheck(healthEl);
void switchView('arena');

async function runHealthCheck(target: HTMLElement): Promise<void> {
  try {
    const h = await getHealth();
    target.textContent = h.databaseOk
      ? `🟢 db ok`
      : `🔴 db error`;
    target.style.color = h.databaseOk ? '#6c6' : 'crimson';
  } catch (err) {
    target.textContent = err instanceof ApiError ? err.message : String(err);
    target.style.color = 'crimson';
  }
}
