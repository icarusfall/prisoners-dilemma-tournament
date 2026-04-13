// @pdt/frontend — entry point with view routing.
//
// Three views: Arena (landing page), Tournament, and How It Works.
// A minimal nav bar at the top lets the user switch between them.
// The arena auto-demo starts immediately on page load.

import { ENGINE_VERSION } from '@pdt/engine';
import { ApiError, BACKEND_URL, getHealth } from './api.js';
import { mountArena, type ArenaHandle } from './arena/arena-runner.js';
import { mountTournamentRunner } from './views/tournament-runner.js';
import { mountHowItWorks, type HowItWorksHandle } from './views/how-it-works.js';
import { mountBotBuilder } from './views/bot-builder.js';
import { mountConnect } from './views/connect.js';

const app = document.getElementById('app');
if (!app) {
  throw new Error('main.ts: #app root element missing from index.html');
}

// ---- Full-viewport layout ----
document.body.style.margin = '0';
document.body.style.overflow = 'hidden';
document.body.style.background = '#f0f0f5';

app.innerHTML = `
  <div id="shell" style="display:flex;flex-direction:column;height:100vh;font-family:system-ui,sans-serif;">
    <nav id="nav" style="display:flex;align-items:center;justify-content:space-between;
                         padding:6px 16px;background:#e8e8f0;color:#333;flex-shrink:0;z-index:20;border-bottom:1px solid #d0d0da;">
      <div style="display:flex;align-items:center;gap:16px;">
        <span style="font-weight:bold;font-size:1rem;">Prisoner's Dilemma</span>
        <button id="tab-arena" style="all:unset;cursor:pointer;padding:4px 12px;border-radius:4px;font-size:0.85rem;">Arena</button>
        <button id="tab-tournament" style="all:unset;cursor:pointer;padding:4px 12px;border-radius:4px;font-size:0.85rem;">Tournament</button>
        <button id="tab-builder" style="all:unset;cursor:pointer;padding:4px 12px;border-radius:4px;font-size:0.85rem;">Create Bot</button>
        <button id="tab-connect" style="all:unset;cursor:pointer;padding:4px 12px;border-radius:4px;font-size:0.85rem;">Connect</button>
        <button id="tab-howit" style="all:unset;cursor:pointer;padding:4px 12px;border-radius:4px;font-size:0.85rem;">How It Works</button>
      </div>
      <div style="display:flex;align-items:center;gap:12px;font-size:0.8rem;color:#999;">
        <span>Engine v${ENGINE_VERSION}</span>
        <span id="health-badge">checking…</span>
      </div>
    </nav>
    <div id="view" style="flex:1;overflow:hidden;position:relative;"></div>
  </div>
`;

const tabArena = document.getElementById('tab-arena') as HTMLButtonElement;
const tabTournament = document.getElementById('tab-tournament') as HTMLButtonElement;
const tabBuilder = document.getElementById('tab-builder') as HTMLButtonElement;
const tabConnect = document.getElementById('tab-connect') as HTMLButtonElement;
const tabHowIt = document.getElementById('tab-howit') as HTMLButtonElement;
const viewEl = document.getElementById('view')!;
const healthEl = document.getElementById('health-badge')!;

// ---- Tab styling ----
const ACTIVE_TAB_STYLE = 'background:#5a6abf;color:#fff;';
const INACTIVE_TAB_STYLE = 'background:transparent;color:#666;';

function setActiveTab(tab: View): void {
  const tabs: Record<View, HTMLButtonElement> = { arena: tabArena, tournament: tabTournament, builder: tabBuilder, connect: tabConnect, howit: tabHowIt };
  for (const [key, btn] of Object.entries(tabs)) {
    btn.style.cssText = `all:unset;cursor:pointer;padding:4px 12px;border-radius:4px;font-size:0.85rem;${key === tab ? ACTIVE_TAB_STYLE : INACTIVE_TAB_STYLE}`;
  }
}

// ---- View management ----
type View = 'arena' | 'tournament' | 'builder' | 'connect' | 'howit';
let currentView: View | null = null;
let arenaHandle: ArenaHandle | null = null;
let howItHandle: HowItWorksHandle | null = null;

// Track requested explainer slug for deep-linking from the arena overlay.
let pendingSlug: string | null = null;

async function switchView(target: View): Promise<void> {
  if (target === currentView && !pendingSlug) return;

  // Teardown current view.
  if (arenaHandle) {
    arenaHandle.destroy();
    arenaHandle = null;
  }
  if (howItHandle) {
    howItHandle.destroy();
    howItHandle = null;
  }
  viewEl.innerHTML = '';
  viewEl.style.overflowY = '';

  currentView = target;
  setActiveTab(target);

  if (target === 'arena') {
    arenaHandle = await mountArena(viewEl);
  } else if (target === 'tournament') {
    const container = document.createElement('div');
    container.style.cssText =
      'max-width:960px;margin:1.5rem auto;padding:0 1rem;overflow-y:auto;height:100%;color:#ddd;';
    viewEl.appendChild(container);
    viewEl.style.overflowY = 'auto';
    await mountTournamentRunner(container);
  } else if (target === 'builder') {
    const container = document.createElement('div');
    container.style.cssText =
      'max-width:960px;margin:1.5rem auto;padding:0 1rem;overflow-y:auto;height:100%;color:#ddd;';
    viewEl.appendChild(container);
    viewEl.style.overflowY = 'auto';
    mountBotBuilder(container);
  } else if (target === 'connect') {
    const container = document.createElement('div');
    container.style.cssText =
      'max-width:960px;margin:1.5rem auto;padding:0 1rem;overflow-y:auto;height:100%;color:#ddd;';
    viewEl.appendChild(container);
    viewEl.style.overflowY = 'auto';
    mountConnect(container);
  } else if (target === 'howit') {
    howItHandle = mountHowItWorks(viewEl);
    if (pendingSlug) {
      howItHandle.show(pendingSlug);
      pendingSlug = null;
    }
  }
}

tabArena.addEventListener('click', () => void switchView('arena'));
tabTournament.addEventListener('click', () => void switchView('tournament'));
tabBuilder.addEventListener('click', () => void switchView('builder'));
tabConnect.addEventListener('click', () => void switchView('connect'));
tabHowIt.addEventListener('click', () => void switchView('howit'));

// Allow other modules to navigate to a specific explainer page.
(window as unknown as Record<string, unknown>).__pdtNavigateExplainer = (slug: string) => {
  pendingSlug = slug;
  void switchView('howit');
};

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
