// Arena runner — orchestrates the simulation and renderer.
//
// Exports `mountArena(root)` which:
//   1. Fetches preset bots from /api/bots.
//   2. Compiles them client-side.
//   3. Creates ArenaBot instances with random positions.
//   4. Initialises the Mapbox renderer.
//   5. Starts the requestAnimationFrame game loop.
//
// On first load, runs an auto-demo with TFT, GRIM, RANDOM, ALLD at a
// slow tick rate. The setup panel (task 14) will let users configure
// custom runs.

import { listBots, type BotRecord } from '../api.js';
import { COLEMAN_STREET } from './offices/coleman-street.js';
import { createRenderer, type ArenaRenderer } from './renderer.js';
import {
  createArenaBot,
  resetInstanceCounter,
  tick,
  type TickResult,
} from './simulation.js';
import {
  pairKey,
  DEMO_CONFIG,
  LINE_DURATION_MS,
  type ArenaBot,
  type ArenaConfig,
  type ArenaEvent,
  type PairState,
} from './types.js';
import { mulberry32 } from '@pdt/engine';
import { createSidePanel, type SidePanel } from './side-panel.js';
import { createNarrator, type Narrator } from './narrator.js';

// Default demo roster: all eight classical presets.
const DEMO_BOT_IDS = ['tft', 'alld', 'grim', 'random', 'allc', 'tf2t', 'pavlov', 'generous_tft'];

// Track active interaction lines for timed removal.
interface ActiveLine {
  pairId: string;
  expiresAt: number;
  narration: string;
}

export interface ArenaHandle {
  /** Stop the game loop and clean up. */
  destroy(): void;
}

export async function mountArena(root: HTMLElement): Promise<ArenaHandle> {
  root.innerHTML = '';

  // ---- Layout ----
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;width:100%;height:100%;';

  const mapContainer = document.createElement('div');
  mapContainer.style.cssText = 'width:100%;height:100%;';
  wrapper.appendChild(mapContainer);

  // Caption bar at the bottom.
  const captionBar = document.createElement('div');
  captionBar.style.cssText =
    'position:absolute;bottom:0;left:0;right:0;padding:8px 16px;' +
    'background:rgba(0,0,0,0.7);color:#ddd;font:13px/1.4 monospace;' +
    'pointer-events:none;z-index:10;min-height:24px;';
  wrapper.appendChild(captionBar);

  // Scoreboard overlay.
  const scoreboard = document.createElement('div');
  scoreboard.style.cssText =
    'position:absolute;top:12px;left:12px;padding:10px 14px;' +
    'background:rgba(0,0,0,0.75);color:#ddd;font:12px/1.5 monospace;' +
    'border-radius:6px;z-index:10;min-width:140px;pointer-events:none;';
  wrapper.appendChild(scoreboard);

  root.appendChild(wrapper);

  // ---- Side panel (created early, populated after bots exist) ----
  let sidePanel: SidePanel | null = null;

  // ---- Fetch bots ----
  let allBots: BotRecord[];
  try {
    allBots = await listBots({ created_via: 'preset' });
  } catch {
    captionBar.textContent = 'Failed to load bots from backend.';
    return { destroy() { root.innerHTML = ''; } };
  }

  const demoBots = allBots.filter((b) => DEMO_BOT_IDS.includes(b.id));
  if (demoBots.length < 2) {
    captionBar.textContent = 'Not enough preset bots available for demo.';
    return { destroy() { root.innerHTML = ''; } };
  }

  // ---- Create arena bots ----
  const config: ArenaConfig = { ...DEMO_CONFIG };
  const seed = Date.now() & 0x7fffffff;
  const rng = mulberry32(seed);
  resetInstanceCounter();

  const arenaBots: ArenaBot[] = demoBots.map((b) =>
    createArenaBot(b.id, b.name, b.spec, [...COLEMAN_STREET.bounds], rng),
  );

  const pairs = new Map<string, PairState>();
  const activeLines: ActiveLine[] = [];

  // ---- Init renderer ----
  let renderer: ArenaRenderer;
  try {
    renderer = await createRenderer(mapContainer, COLEMAN_STREET);
  } catch (err) {
    captionBar.textContent = `Map failed to load: ${err instanceof Error ? err.message : err}`;
    return { destroy() { root.innerHTML = ''; } };
  }

  // ---- Side panel ----
  sidePanel = createSidePanel(
    () => arenaBots,
    () => pairs,
  );
  wrapper.appendChild(sidePanel.el);

  renderer.onBotClick((instanceId) => {
    if (sidePanel!.selectedId() === instanceId) {
      sidePanel!.close();
    } else {
      sidePanel!.open(instanceId);
    }
  });

  renderer.onLineHover((pid, lngLat) => {
    const line = activeLines.find((l) => l.pairId === pid);
    if (line) renderer.showTooltip(lngLat, line.narration);
  });

  renderer.onLineLeave(() => {
    renderer.hideTooltip();
  });

  // ---- Narrator ----
  const narrator: Narrator = createNarrator(
    () => arenaBots,
    () => pairs,
  );

  // Caption display state.
  const captionLines: { text: string; expiresAt: number }[] = [];
  const CAPTION_DURATION_MS = 5000;
  const MAX_CAPTIONS = 3;

  function pushCaption(text: string, now: number): void {
    captionLines.push({ text, expiresAt: now + CAPTION_DURATION_MS });
    if (captionLines.length > MAX_CAPTIONS) captionLines.shift();
  }

  function renderCaptions(now: number): void {
    while (captionLines.length > 0 && captionLines[0]!.expiresAt < now) {
      captionLines.shift();
    }
    captionBar.textContent = captionLines.map((c) => c.text).join('  |  ');
  }

  function renderScoreboard(): void {
    const sorted = [...arenaBots].sort((a, b) => b.score - a.score);
    scoreboard.innerHTML =
      '<div style="font-weight:bold;margin-bottom:4px;">Scores</div>' +
      sorted
        .map((b) => `<div>${b.name}: ${b.score}</div>`)
        .join('');
  }

  function processEvents(events: ArenaEvent[], now: number): void {
    // Show interaction lines for all interactions.
    for (const ev of events) {
      if (ev.type === 'interaction') {
        const a = arenaBots.find((b) => b.instanceId === ev.aId);
        const b = arenaBots.find((bot) => bot.instanceId === ev.bId);
        if (a && b) {
          const pid = pairKey(a.instanceId, b.instanceId);
          renderer.showInteractionLine(a, b, pid);
          const narration = `${ev.narrationA}\n${ev.narrationB}`;
          activeLines.push({ pairId: pid, expiresAt: now + LINE_DURATION_MS, narration });
        }
      }
    }

    // Let the narrator decide which events deserve captions.
    const captions = narrator.process(events, now);
    for (const caption of captions) {
      pushCaption(caption.text, now);
    }
  }

  // ---- Game loop ----
  let lastTime = performance.now();
  let lastPanelRefresh = 0;
  const PANEL_REFRESH_INTERVAL = 500; // ms
  let animFrameId = 0;
  let destroyed = false;

  function loop(timestamp: number): void {
    if (destroyed) return;

    const dt = Math.min((timestamp - lastTime) / 1000, 0.1); // cap at 100ms
    lastTime = timestamp;
    const now = timestamp;

    // Run simulation tick.
    const result: TickResult = tick(
      arenaBots,
      pairs,
      dt,
      now,
      [...COLEMAN_STREET.bounds],
      rng,
      config,
    );

    // Expire interaction lines.
    for (let i = activeLines.length - 1; i >= 0; i--) {
      if (now >= activeLines[i]!.expiresAt) {
        renderer.removeInteractionLine(activeLines[i]!.pairId);
        activeLines.splice(i, 1);
      }
    }

    // Process events and update UI.
    processEvents(result.events, now);
    renderCaptions(now);
    renderScoreboard();
    renderer.updateBots(arenaBots);

    // Refresh side panel on a slower cadence.
    if (sidePanel?.selectedId() && now - lastPanelRefresh > PANEL_REFRESH_INTERVAL) {
      sidePanel.refresh();
      lastPanelRefresh = now;
    }

    animFrameId = requestAnimationFrame(loop);
  }

  // Initial render.
  renderer.updateBots(arenaBots);
  renderScoreboard();
  pushCaption('Arena demo started — watching classical bots interact...', performance.now());
  renderCaptions(performance.now());

  animFrameId = requestAnimationFrame(loop);

  return {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(animFrameId);
      sidePanel?.close();
      renderer.destroy();
      root.innerHTML = '';
    },
  };
}
