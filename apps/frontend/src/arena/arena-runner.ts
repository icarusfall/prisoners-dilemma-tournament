// Arena runner — orchestrates the simulation and renderer.
//
// Exports `mountArena(root)` which:
//   1. Fetches preset bots from /api/bots.
//   2. Compiles them client-side.
//   3. Creates ArenaBot instances with random positions.
//   4. Initialises the Mapbox renderer.
//   5. Starts the requestAnimationFrame game loop.
//
// The setup panel lets users pick bots and adjust speed, then restart
// the simulation without destroying the Mapbox map.

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
import { createExplainerOverlay, type ExplainerOverlay } from './explainer-overlay.js';
import { createSetupPanel, type SetupPanel } from './setup-panel.js';

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

  // "What am I looking at?" explainer overlay.
  const explainer: ExplainerOverlay = createExplainerOverlay();
  wrapper.appendChild(explainer.el);

  root.appendChild(wrapper);

  // ---- Fetch all preset bots ----
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

  // ---- Init renderer (expensive — kept alive across restarts) ----
  let renderer: ArenaRenderer;
  try {
    renderer = await createRenderer(mapContainer, COLEMAN_STREET);
  } catch (err) {
    captionBar.textContent = `Map failed to load: ${err instanceof Error ? err.message : err}`;
    return { destroy() { root.innerHTML = ''; } };
  }

  // ---- Mutable simulation state (rebuilt on restart) ----
  let arenaBots: ArenaBot[] = [];
  let pairs = new Map<string, PairState>();
  let activeLines: ActiveLine[] = [];
  let narrator: Narrator;
  let config: ArenaConfig;
  let rng: () => number;
  let animFrameId = 0;
  let loopRunning = false;

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
    const captions = narrator.process(events, now);
    for (const caption of captions) {
      pushCaption(caption.text, now);
    }
  }

  // ---- Side panel ----
  let sidePanel: SidePanel = createSidePanel(
    () => arenaBots,
    () => pairs,
  );
  wrapper.appendChild(sidePanel.el);

  renderer.onBotClick((instanceId) => {
    if (sidePanel.selectedId() === instanceId) {
      sidePanel.close();
    } else {
      sidePanel.open(instanceId);
    }
  });

  renderer.onLineHover((pid, lngLat) => {
    const line = activeLines.find((l) => l.pairId === pid);
    if (line) renderer.showTooltip(lngLat, line.narration);
  });

  renderer.onLineLeave(() => {
    renderer.hideTooltip();
  });

  // ---- Game loop ----
  let lastTime = 0;
  let lastPanelRefresh = 0;
  const PANEL_REFRESH_INTERVAL = 500;

  function loop(timestamp: number): void {
    if (!loopRunning) return;

    const dt = lastTime === 0 ? 0.016 : Math.min((timestamp - lastTime) / 1000, 0.1);
    lastTime = timestamp;
    const now = timestamp;

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

    processEvents(result.events, now);
    renderCaptions(now);
    renderScoreboard();
    renderer.updateBots(arenaBots);

    if (sidePanel.selectedId() && now - lastPanelRefresh > PANEL_REFRESH_INTERVAL) {
      sidePanel.refresh();
      lastPanelRefresh = now;
    }

    animFrameId = requestAnimationFrame(loop);
  }

  // ---- Start / restart simulation ----
  function startSimulation(botRecords: BotRecord[], newConfig: ArenaConfig, message: string): void {
    // Stop existing loop.
    loopRunning = false;
    cancelAnimationFrame(animFrameId);

    // Clear visual state.
    sidePanel.close();
    renderer.clearInteractionLines();
    renderer.hideTooltip();
    captionLines.length = 0;

    // Reset simulation state.
    config = { ...newConfig };
    const seed = Date.now() & 0x7fffffff;
    rng = mulberry32(seed);
    resetInstanceCounter();

    // Disambiguate names when multiple instances of the same bot exist.
    const idCounts = new Map<string, number>();
    for (const b of botRecords) idCounts.set(b.id, (idCounts.get(b.id) ?? 0) + 1);
    const idSeen = new Map<string, number>();

    arenaBots = botRecords.map((b) => {
      const total = idCounts.get(b.id)!;
      const idx = (idSeen.get(b.id) ?? 0) + 1;
      idSeen.set(b.id, idx);
      const displayName = total > 1 ? `${b.name} (${idx})` : b.name;
      return createArenaBot(b.id, displayName, b.spec, [...COLEMAN_STREET.bounds], rng);
    });
    pairs = new Map();
    activeLines = [];

    narrator = createNarrator(
      () => arenaBots,
      () => pairs,
    );

    // Kick off.
    renderer.updateBots(arenaBots);
    renderScoreboard();
    pushCaption(message, performance.now());
    renderCaptions(performance.now());

    lastTime = 0;
    lastPanelRefresh = 0;
    loopRunning = true;
    animFrameId = requestAnimationFrame(loop);
  }

  // ---- Setup panel ----
  let setupPanel: SetupPanel = createSetupPanel({
    allBots,
    activeBotIds: demoBots.map((b) => b.id),
    onStart(roster, newConfig) {
      if (roster.length < 2) return;
      startSimulation(roster, newConfig, `Custom arena started — ${roster.length} bots competing...`);
    },
  });
  wrapper.appendChild(setupPanel.el);

  // ---- Initial auto-demo ----
  startSimulation(demoBots, DEMO_CONFIG, 'Arena demo started — watching classical bots interact...');

  // ---- Teardown ----
  let destroyed = false;

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      loopRunning = false;
      cancelAnimationFrame(animFrameId);
      sidePanel.close();
      setupPanel.destroy();
      explainer.destroy();
      renderer.destroy();
      root.innerHTML = '';
    },
  };
}
