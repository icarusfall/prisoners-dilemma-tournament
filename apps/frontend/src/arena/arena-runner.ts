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

import {
  listBots,
  createPendingDecision as apiCreatePending,
  pollDecision as apiPollDecision,
  clearPendingDecisions as apiClearPending,
  type BotRecord,
} from '../api.js';
import { COLEMAN_STREET } from './offices/coleman-street.js';
import { createRenderer, type ArenaRenderer } from './renderer.js';
import {
  createArenaBot,
  createZombieBot,
  resetInstanceCounter,
  tick,
  findCollisions,
  playArenaRound,
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
import { mulberry32, scoreRound, GAME_TYPES, type GameType, type Payoffs, type Move } from '@pdt/engine';
import { createSidePanel, type SidePanel } from './side-panel.js';
import { createNarrator, type Narrator } from './narrator.js';
import { createExplainerOverlay, type ExplainerOverlay } from './explainer-overlay.js';
import { createSetupPanel, type SetupPanel, type ZombieSetup } from './setup-panel.js';

// Default demo roster: all ten classical presets.
const DEMO_BOT_IDS = ['tft', 'alld', 'grim', 'random', 'allc', 'tf2t', 'pavlov', 'generous_tft', 'joss', 'prober'];

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
    'background:rgba(255,255,255,0.85);color:#333;font:13px/1.4 monospace;' +
    'pointer-events:none;z-index:10;min-height:24px;backdrop-filter:blur(4px);border-top:1px solid #ddd;';
  wrapper.appendChild(captionBar);

  // Scoreboard overlay.
  const scoreboard = document.createElement('div');
  scoreboard.style.cssText =
    'position:absolute;top:12px;left:12px;padding:10px 14px;' +
    'background:rgba(255,255,255,0.9);color:#333;font:12px/1.5 monospace;' +
    'border-radius:6px;z-index:10;min-width:140px;pointer-events:none;' +
    'box-shadow:0 1px 6px rgba(0,0,0,0.1);border:1px solid #ddd;';
  wrapper.appendChild(scoreboard);

  // "What am I looking at?" explainer overlay.
  const explainer: ExplainerOverlay = createExplainerOverlay();
  wrapper.appendChild(explainer.el);

  root.appendChild(wrapper);

  // ---- Fetch all bots (presets + user-created) ----
  let allBots: BotRecord[];
  try {
    allBots = await listBots();
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
  let currentGameType: GameType = 'prisoners-dilemma';
  let currentPayoffs: Payoffs = GAME_TYPES['prisoners-dilemma'].payoffs;
  let animFrameId = 0;
  let loopRunning = false;
  let liveBotIds = new Set<string>();

  // Track pending live decisions being polled.
  interface LivePending {
    decisionId: string;
    a: ArenaBot;
    b: ArenaBot;
    /** Which bot (a, b, or both) is live. */
    liveA: boolean;
    liveB: boolean;
    pollTimer: ReturnType<typeof setInterval>;
    createdAt: number;
  }
  const livePendings: LivePending[] = [];

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

  // ---- Live-decision helpers ----

  let decisionCounter = 0;

  function isLiveBot(bot: ArenaBot): boolean {
    return config.slowTick && (bot.isLive === true);
  }

  /**
   * Handle a collision where at least one bot is live.
   * Posts a pending decision to the backend for each live bot involved,
   * then polls for the response. When both moves are known, resolves
   * the round normally.
   */
  function handleLiveCollision(a: ArenaBot, b: ArenaBot, now: number): void {
    const liveA = isLiveBot(a);
    const liveB = isLiveBot(b);

    // Build the pair context.
    const key = pairKey(a.instanceId, b.instanceId);
    const isFirstA = a.instanceId < b.instanceId;

    let pair = pairs.get(key);
    if (!pair) {
      let h = 0;
      for (const ch of key) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
      pair = { movesA: [], movesB: [], lastInteraction: 0, seed: h >>> 0 };
      pairs.set(key, pair);
    }

    const myMovesForA = isFirstA ? pair.movesA : pair.movesB;
    const theirMovesForA = isFirstA ? pair.movesB : pair.movesA;
    const myMovesForB = isFirstA ? pair.movesB : pair.movesA;
    const theirMovesForB = isFirstA ? pair.movesA : pair.movesB;
    const round = myMovesForA.length;

    // Set waiting visual state.
    if (liveA) { a.visualState = 'waiting'; a.flashUntil = Infinity; }
    if (liveB) { b.visualState = 'waiting'; b.flashUntil = Infinity; }

    // Mark cooldown so we don't re-collide during polling.
    pair.lastInteraction = now + 60_000;

    // We may need to collect up to 2 moves.
    let moveA: Move | null = liveA ? null : a.decide({
      selfInstanceId: a.instanceId,
      opponentInstanceId: b.instanceId,
      round,
      history: { myMoves: [...myMovesForA], theirMoves: [...theirMovesForA] },
      rng: () => Math.random(),
    });
    let moveB: Move | null = liveB ? null : b.decide({
      selfInstanceId: b.instanceId,
      opponentInstanceId: a.instanceId,
      round,
      history: { myMoves: [...myMovesForB], theirMoves: [...theirMovesForB] },
      rng: () => Math.random(),
    });

    // Post pending decisions for live bots.
    const decId = `live-${++decisionCounter}-${Date.now()}`;

    // For simplicity, create one pending decision per live bot.
    // If both are live, the first responder doesn't resolve the round;
    // we wait for both.
    const pending: LivePending = {
      decisionId: decId,
      a, b,
      liveA, liveB,
      pollTimer: 0 as unknown as ReturnType<typeof setInterval>,
      createdAt: Date.now(),
    };

    const POLL_INTERVAL = 1000;
    const TIMEOUT = 30_000;

    // Create pending decisions for each live bot and start polling.
    const decIdA = liveA ? `${decId}-a` : null;
    const decIdB = liveB ? `${decId}-b` : null;

    if (liveA && decIdA) {
      a.pendingDecisionId = decIdA;
      apiCreatePending({
        id: decIdA,
        botInstanceId: a.instanceId,
        botId: a.botId,
        botName: a.name,
        opponentInstanceId: b.instanceId,
        opponentName: b.name,
        round,
        myMoves: [...myMovesForA],
        theirMoves: [...theirMovesForA],
      }).catch(() => { /* ignore network errors — will timeout */ });
    }

    if (liveB && decIdB) {
      b.pendingDecisionId = decIdB;
      apiCreatePending({
        id: decIdB,
        botInstanceId: b.instanceId,
        botId: b.botId,
        botName: b.name,
        opponentInstanceId: a.instanceId,
        opponentName: a.name,
        round,
        myMoves: [...myMovesForB],
        theirMoves: [...theirMovesForB],
      }).catch(() => { /* ignore network errors — will timeout */ });
    }

    function resolveRound(): void {
      if (moveA === null || moveB === null) return;

      clearInterval(pending.pollTimer);
      const idx = livePendings.indexOf(pending);
      if (idx >= 0) livePendings.splice(idx, 1);

      // Score and record.
      const result = scoreRound(moveA!, moveB!, currentPayoffs);
      a.score += result.scoreA;
      b.score += result.scoreB;

      // Visual flash.
      a.visualState = moveA === 'C' ? 'cooperate' : 'defect';
      b.visualState = moveB === 'C' ? 'cooperate' : 'defect';
      const flashNow = performance.now();
      a.flashUntil = flashNow + config.flashDurationMs;
      b.flashUntil = flashNow + config.flashDurationMs;
      a.pendingDecisionId = null;
      b.pendingDecisionId = null;

      // Record in pair history.
      if (isFirstA) {
        pair!.movesA.push(moveA!);
        pair!.movesB.push(moveB!);
      } else {
        pair!.movesA.push(moveB!);
        pair!.movesB.push(moveA!);
      }
      pair!.lastInteraction = performance.now();

      // Events.
      const isFirstMeeting = round === 0;
      const events: ArenaEvent[] = [{
        type: 'interaction',
        aId: a.instanceId,
        bId: b.instanceId,
        moveA: moveA!,
        moveB: moveB!,
        scoreA: result.scoreA,
        scoreB: result.scoreB,
        narrationA: `${a.name} played ${moveA}`,
        narrationB: `${b.name} played ${moveB}`,
      }];
      if (isFirstMeeting) {
        events.push({ type: 'first_meeting', aId: a.instanceId, bId: b.instanceId });
      }
      processEvents(events, performance.now());
      renderScoreboard();
    }

    function fallbackOnTimeout(): void {
      // Use BotSpec default for any live bot that hasn't responded.
      if (moveA === null) moveA = a.decide({
        selfInstanceId: a.instanceId,
        opponentInstanceId: b.instanceId,
        round,
        history: { myMoves: [...myMovesForA], theirMoves: [...theirMovesForA] },
        rng: () => Math.random(),
      });
      if (moveB === null) moveB = b.decide({
        selfInstanceId: b.instanceId,
        opponentInstanceId: a.instanceId,
        round,
        history: { myMoves: [...myMovesForB], theirMoves: [...theirMovesForB] },
        rng: () => Math.random(),
      });
      resolveRound();
    }

    pending.pollTimer = setInterval(async () => {
      const elapsed = Date.now() - pending.createdAt;
      if (elapsed > TIMEOUT) {
        pushCaption('Decision timed out — falling back to BotSpec default.', performance.now());
        fallbackOnTimeout();
        return;
      }

      try {
        if (liveA && decIdA && moveA === null) {
          const resp = await apiPollDecision(decIdA);
          if (resp.resolved && resp.move) {
            moveA = resp.move;
            pushCaption(`${a.name} chose ${resp.move === 'C' ? 'Cooperate' : 'Defect'} (live)`, performance.now());
          } else if (resp.expired) {
            moveA = a.decide({
              selfInstanceId: a.instanceId, opponentInstanceId: b.instanceId, round,
              history: { myMoves: [...myMovesForA], theirMoves: [...theirMovesForA] },
              rng: () => Math.random(),
            });
          }
        }
        if (liveB && decIdB && moveB === null) {
          const resp = await apiPollDecision(decIdB);
          if (resp.resolved && resp.move) {
            moveB = resp.move;
            pushCaption(`${b.name} chose ${resp.move === 'C' ? 'Cooperate' : 'Defect'} (live)`, performance.now());
          } else if (resp.expired) {
            moveB = b.decide({
              selfInstanceId: b.instanceId, opponentInstanceId: a.instanceId, round,
              history: { myMoves: [...myMovesForB], theirMoves: [...theirMovesForB] },
              rng: () => Math.random(),
            });
          }
        }
      } catch {
        // Network error — will retry next poll or timeout
      }

      resolveRound();
    }, POLL_INTERVAL);

    livePendings.push(pending);
  }

  // ---- Game loop ----
  let lastTime = 0;
  let lastPanelRefresh = 0;
  const PANEL_REFRESH_INTERVAL = 500;

  function loop(timestamp: number): void {
    if (!loopRunning) return;

    const dt = lastTime === 0 ? 0.016 : Math.min((timestamp - lastTime) / 1000, 0.1);
    lastTime = timestamp;
    const now = timestamp;

    if (config.slowTick) {
      // In slow-tick mode, we run movement via tick() but intercept
      // collisions involving live bots before they resolve.
      // First run tick normally — it handles movement, zombie collisions,
      // and non-live-bot collisions.
      const collisions = findCollisions(arenaBots, pairs, now, config);
      const liveCollisions: [ArenaBot, ArenaBot][] = [];
      const normalCollisions: [ArenaBot, ArenaBot][] = [];

      for (const [a, b] of collisions) {
        // Skip if either bot is already waiting for a decision.
        if (a.pendingDecisionId || b.pendingDecisionId) continue;

        if (isLiveBot(a) || isLiveBot(b)) {
          liveCollisions.push([a, b]);
        } else {
          normalCollisions.push([a, b]);
        }
      }

      // Handle live collisions asynchronously.
      for (const [a, b] of liveCollisions) {
        handleLiveCollision(a, b, now);
      }

      // Run normal tick (which will also re-detect and handle the
      // normal collisions — but we already consumed the live ones).
      const result: TickResult = tick(arenaBots, pairs, dt, now, [...COLEMAN_STREET.bounds], rng, config, currentPayoffs);
      processEvents(result.events, now);
    } else {
      const result: TickResult = tick(
        arenaBots,
        pairs,
        dt,
        now,
        [...COLEMAN_STREET.bounds],
        rng,
        config,
        currentPayoffs,
      );
      processEvents(result.events, now);
    }

    // Expire interaction lines.
    for (let i = activeLines.length - 1; i >= 0; i--) {
      if (now >= activeLines[i]!.expiresAt) {
        renderer.removeInteractionLine(activeLines[i]!.pairId);
        activeLines.splice(i, 1);
      }
    }

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
  function startSimulation(botRecords: BotRecord[], newConfig: ArenaConfig, message: string, zombies: ZombieSetup = { shamblers: 0, infected: 0 }, newLiveBotIds: Set<string> = new Set(), gameType: GameType = 'prisoners-dilemma'): void {
    // Stop existing loop.
    loopRunning = false;
    cancelAnimationFrame(animFrameId);

    // Clean up any active live pendings.
    for (const p of livePendings) clearInterval(p.pollTimer);
    livePendings.length = 0;
    liveBotIds = newLiveBotIds;

    // Clear backend pending decisions.
    if (newConfig.slowTick) apiClearPending().catch(() => {});

    // Clear visual state.
    sidePanel.close();
    renderer.clearInteractionLines();
    renderer.hideTooltip();
    captionLines.length = 0;

    // Reset simulation state.
    currentGameType = gameType;
    currentPayoffs = GAME_TYPES[gameType].payoffs;
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
      const bot = createArenaBot(b.id, displayName, b.spec, [...COLEMAN_STREET.bounds], rng);
      if (liveBotIds.has(b.id)) bot.isLive = true;
      return bot;
    });
    // Spawn zombies.
    for (let i = 0; i < zombies.shamblers; i++) {
      arenaBots.push(createZombieBot('shambler', [...COLEMAN_STREET.bounds], rng));
    }
    for (let i = 0; i < zombies.infected; i++) {
      arenaBots.push(createZombieBot('infected', [...COLEMAN_STREET.bounds], rng));
    }

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
    onStart(roster, newConfig, zombies, newLiveBotIds, gameType) {
      if (roster.length < 2) return;
      const zombieTotal = zombies.shamblers + zombies.infected;
      const zombieMsg = zombieTotal > 0 ? ` with ${zombieTotal} zombie${zombieTotal > 1 ? 's' : ''}` : '';
      const liveMsg = newLiveBotIds.size > 0 ? ` (${newLiveBotIds.size} live)` : '';
      const gameMsg = gameType !== 'prisoners-dilemma' ? ` [${GAME_TYPES[gameType].label}]` : '';
      startSimulation(roster, newConfig, `Custom arena started — ${roster.length} bots competing${zombieMsg}${liveMsg}${gameMsg}...`, zombies, newLiveBotIds, gameType);
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
      for (const p of livePendings) clearInterval(p.pollTimer);
      livePendings.length = 0;
      sidePanel.close();
      setupPanel.destroy();
      explainer.destroy();
      renderer.destroy();
      root.innerHTML = '';
    },
  };
}
