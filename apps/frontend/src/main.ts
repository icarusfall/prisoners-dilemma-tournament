// @pdt/frontend — entry point.
//
// Phase 1 task 12 deliverable: a single page that proves the type-safe
// API client round-trips against the deployed backend. There is *no*
// real UI here yet — that lands in task 13 (pick bots → run tournament
// → render leaderboard / generations chart). The point of this file is
// to surface, on screen, that:
//
//   1. The Vite + workspace TypeScript path mapping resolves @pdt/engine.
//   2. The frontend can reach the configured backend.
//   3. The /health and /api/bots endpoints return the expected shapes.
//
// If any of those fail, the failure is visible the moment you open the
// page, with a useful error string from `ApiError`.

import { ENGINE_VERSION } from '@pdt/engine';
import { ApiError, BACKEND_URL, getHealth, listBots } from './api.js';

const app = document.getElementById('app');
if (!app) {
  throw new Error('main.ts: #app root element missing from index.html');
}

// Render a tiny bit of structure up-front so the user sees *something*
// the moment the script runs, not a blank page while fetches are in
// flight. The fetched values populate empty placeholders below.
app.innerHTML = `
  <main style="font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem;">
    <h1 style="margin-bottom: 0.25rem;">Prisoner's Dilemma Tournament</h1>
    <p style="color: #555; margin-top: 0;">
      Frontend skeleton — engine v${ENGINE_VERSION}. Real UI lands in task 13.
    </p>

    <section>
      <h2 style="font-size: 1.1rem;">Backend</h2>
      <p style="margin: 0;"><code>${escapeHtml(BACKEND_URL)}</code></p>
      <p id="health" style="margin: 0.25rem 0;">Checking <code>/health</code>…</p>
    </section>

    <section style="margin-top: 1.5rem;">
      <h2 style="font-size: 1.1rem;">Bot library</h2>
      <p id="bots-status" style="margin: 0;">Loading bots…</p>
      <ul id="bots-list" style="margin-top: 0.5rem;"></ul>
    </section>
  </main>
`;

const healthEl = document.getElementById('health')!;
const botsStatusEl = document.getElementById('bots-status')!;
const botsListEl = document.getElementById('bots-list')!;

void runHealthCheck(healthEl);
void runBotsList(botsStatusEl, botsListEl);

async function runHealthCheck(target: HTMLElement): Promise<void> {
  try {
    const h = await getHealth();
    const dbBadge = h.databaseOk ? '🟢 db ok' : '🔴 db error';
    target.textContent = `${dbBadge} · uptime ${h.uptimeSeconds}s · engine v${h.engineVersion}`;
  } catch (err) {
    target.textContent = formatError(err);
    target.style.color = 'crimson';
  }
}

async function runBotsList(statusTarget: HTMLElement, listTarget: HTMLElement): Promise<void> {
  try {
    const bots = await listBots();
    statusTarget.textContent = `${bots.length} bot${bots.length === 1 ? '' : 's'} in the library:`;
    listTarget.innerHTML = bots
      .map(
        (b) =>
          `<li><strong>${escapeHtml(b.name)}</strong> ` +
          `<code style="color: #666;">${escapeHtml(b.id)}</code> ` +
          `<span style="color: #888;">— ${escapeHtml(b.created_via)}</span></li>`,
      )
      .join('');
  } catch (err) {
    statusTarget.textContent = formatError(err);
    statusTarget.style.color = 'crimson';
  }
}

function formatError(err: unknown): string {
  if (err instanceof ApiError) return `${err.message}`;
  if (err instanceof Error) return `error: ${err.message}`;
  return `error: ${String(err)}`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
