// @pdt/frontend — entry point.
//
// Phase 1 task 13: hand the page off to the tournament-runner view.
// We still keep a tiny health badge at the top so a broken backend
// is visible at a glance without having to open devtools, but the
// real estate below the header belongs to the runner.

import { ENGINE_VERSION } from '@pdt/engine';
import { ApiError, BACKEND_URL, getHealth } from './api.js';
import { mountTournamentRunner } from './views/tournament-runner.js';

const app = document.getElementById('app');
if (!app) {
  throw new Error('main.ts: #app root element missing from index.html');
}

app.innerHTML = `
  <main style="font-family: system-ui, sans-serif; max-width: 960px;
               margin: 1.5rem auto; padding: 0 1rem;">
    <header style="display:flex; align-items:baseline; justify-content:space-between;
                   gap:1rem; flex-wrap:wrap; margin-bottom:1rem;">
      <div>
        <h1 style="margin:0;">Prisoner's Dilemma Tournament</h1>
        <p style="margin:0.1rem 0 0; color:#666; font-size:0.9rem;">
          Engine v${ENGINE_VERSION} ·
          backend <code>${escapeHtml(BACKEND_URL)}</code>
        </p>
      </div>
      <div id="health-badge" style="font-size:0.9rem; color:#555;">checking…</div>
    </header>

    <section id="runner"></section>
  </main>
`;

const healthEl = document.getElementById('health-badge')!;
const runnerEl = document.getElementById('runner')!;

void runHealthCheck(healthEl);
void mountTournamentRunner(runnerEl);

async function runHealthCheck(target: HTMLElement): Promise<void> {
  try {
    const h = await getHealth();
    target.textContent = h.databaseOk
      ? `🟢 db ok · uptime ${h.uptimeSeconds}s`
      : `🔴 db error`;
  } catch (err) {
    target.textContent = err instanceof ApiError ? err.message : String(err);
    target.style.color = 'crimson';
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
