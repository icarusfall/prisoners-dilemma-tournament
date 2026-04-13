// Arena setup panel — lets users pick bots (with quantities) and adjust
// speed before starting a custom arena run.
//
// Each bot row has a −/+ stepper so users can add multiple instances of
// the same strategy (e.g. 3× TFT, 2× ALLD).  The "Start" callback
// receives a flat array of BotRecords with duplicates for multi-instance.

import type { BotRecord } from '../api.js';
import type { ArenaConfig } from './types.js';
import { DEFAULT_CONFIG, SLOW_TICK_CONFIG } from './types.js';
import { GAME_TYPES, type GameType } from '@pdt/engine';
import { LOCATIONS, LOCATION_IDS, DEFAULT_LOCATION, type LocationId } from './offices/index.js';

export interface ZombieSetup {
  shamblers: number;
  infected: number;
}

export interface SetupPanelOptions {
  /** All available bots from the backend. */
  allBots: BotRecord[];
  /** Bot IDs currently in the arena (may contain duplicates for instances). */
  activeBotIds: string[];
  /** Called when the user hits "Start".  Receives a flat BotRecord[] (with dupes) + config + zombie setup + live bot IDs + game type + location. */
  onStart(bots: BotRecord[], config: ArenaConfig, zombies: ZombieSetup, liveBotIds: Set<string>, gameType: GameType, location: LocationId): void;
}

export interface SetupPanel {
  el: HTMLElement;
  destroy(): void;
}

const MAX_INSTANCES = 10;

// Speed presets: label → speed multiplier.
const SPEED_PRESETS = [
  { label: '0.5×', speed: 5, tick: 100 },
  { label: '1×', speed: 10, tick: 100 },
  { label: '2×', speed: 20, tick: 50 },
  { label: '3×', speed: 30, tick: 50 },
  { label: '5×', speed: 50, tick: 30 },
] as const;
const DEFAULT_SPEED_INDEX = 1;

export function createSetupPanel(opts: SetupPanelOptions): SetupPanel {
  const { allBots, activeBotIds, onStart } = opts;

  // Count how many instances of each bot are active.
  const counts = new Map<string, number>();
  for (const id of activeBotIds) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  // ---- Gear button ----
  const gearBtn = document.createElement('button');
  gearBtn.textContent = '⚙ Setup';
  gearBtn.style.cssText =
    'position:absolute;top:52px;right:12px;z-index:15;' +
    'padding:7px 12px;border:1px solid #ccc;border-radius:6px;' +
    'background:rgba(255,255,255,0.9);color:#333;font:13px/1 system-ui,sans-serif;' +
    'cursor:pointer;backdrop-filter:blur(4px);transition:background 0.15s;box-shadow:0 1px 4px rgba(0,0,0,0.1);';
  gearBtn.addEventListener('mouseenter', () => { gearBtn.style.background = 'rgba(230,230,240,0.95)'; });
  gearBtn.addEventListener('mouseleave', () => { gearBtn.style.background = 'rgba(255,255,255,0.9)'; });

  // ---- Panel ----
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:absolute;top:0;right:0;width:300px;height:100%;z-index:22;' +
    'background:rgba(245,245,250,0.97);backdrop-filter:blur(8px);' +
    'border-left:1px solid #ddd;' +
    'display:none;flex-direction:column;color:#333;font:13px/1.5 system-ui,sans-serif;' +
    'overflow-y:auto;';

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #ddd;flex-shrink:0;';
  header.innerHTML = '<span style="font-weight:bold;font-size:0.95rem;">Arena Setup</span>';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'all:unset;cursor:pointer;font-size:18px;color:#999;padding:2px 6px;';
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#333'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#999'; });
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // ---- Location section ----
  const locSection = document.createElement('div');
  locSection.style.cssText = 'padding:14px 16px;border-bottom:1px solid #ddd;flex-shrink:0;';

  const locLabel = document.createElement('div');
  locLabel.style.cssText = 'font-weight:bold;margin-bottom:8px;font-size:0.85rem;color:#888;text-transform:uppercase;letter-spacing:0.5px;';
  locLabel.textContent = 'Location';
  locSection.appendChild(locLabel);

  let selectedLocation: LocationId = DEFAULT_LOCATION;
  const locSelect = document.createElement('select');
  locSelect.style.cssText =
    'width:100%;padding:6px 8px;border:1px solid #ccc;border-radius:4px;' +
    'font:13px/1.4 system-ui,sans-serif;color:#333;background:#fff;cursor:pointer;';
  for (const id of LOCATION_IDS) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = LOCATIONS[id].label;
    if (id === selectedLocation) opt.selected = true;
    locSelect.appendChild(opt);
  }
  locSelect.addEventListener('change', () => {
    selectedLocation = locSelect.value as LocationId;
  });
  locSection.appendChild(locSelect);
  panel.appendChild(locSection);

  // ---- Speed section ----
  const speedSection = document.createElement('div');
  speedSection.style.cssText = 'padding:14px 16px;border-bottom:1px solid #ddd;flex-shrink:0;';

  const speedLabel = document.createElement('div');
  speedLabel.style.cssText = 'font-weight:bold;margin-bottom:8px;font-size:0.85rem;color:#888;text-transform:uppercase;letter-spacing:0.5px;';
  speedLabel.textContent = 'Speed';
  speedSection.appendChild(speedLabel);

  const speedRow = document.createElement('div');
  speedRow.style.cssText = 'display:flex;gap:6px;';

  let currentSpeedIndex = DEFAULT_SPEED_INDEX;
  const speedBtns: HTMLButtonElement[] = [];

  SPEED_PRESETS.forEach((preset, i) => {
    const btn = document.createElement('button');
    btn.textContent = preset.label;
    btn.style.cssText = speedBtnStyle(i === currentSpeedIndex);
    btn.addEventListener('click', () => {
      currentSpeedIndex = i;
      speedBtns.forEach((b, j) => { b.style.cssText = speedBtnStyle(j === i); });
    });
    speedBtns.push(btn);
    speedRow.appendChild(btn);
  });

  speedSection.appendChild(speedRow);
  panel.appendChild(speedSection);

  // ---- Game type section ----
  const gameSection = document.createElement('div');
  gameSection.style.cssText = 'padding:14px 16px;border-bottom:1px solid #ddd;flex-shrink:0;';

  const gameLabel = document.createElement('div');
  gameLabel.style.cssText = 'font-weight:bold;margin-bottom:8px;font-size:0.85rem;color:#888;text-transform:uppercase;letter-spacing:0.5px;';
  gameLabel.textContent = 'Game Type';
  gameSection.appendChild(gameLabel);

  let selectedGameType: GameType = 'prisoners-dilemma';
  const gameTypeKeys = Object.keys(GAME_TYPES) as GameType[];
  const gameBtns: HTMLButtonElement[] = [];

  const gameRow = document.createElement('div');
  gameRow.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

  const gameDesc = document.createElement('div');
  gameDesc.style.cssText = 'font-size:0.75rem;color:#888;margin-top:6px;line-height:1.4;';
  gameDesc.textContent = GAME_TYPES[selectedGameType].description;

  for (const gt of gameTypeKeys) {
    const btn = document.createElement('button');
    btn.textContent = GAME_TYPES[gt].label;
    btn.style.cssText = gameBtnStyle(gt === selectedGameType);
    btn.addEventListener('click', () => {
      selectedGameType = gt;
      gameBtns.forEach((b, j) => { b.style.cssText = gameBtnStyle(gameTypeKeys[j] === gt); });
      gameDesc.textContent = GAME_TYPES[gt].description;
    });
    gameBtns.push(btn);
    gameRow.appendChild(btn);
  }

  gameSection.appendChild(gameRow);
  gameSection.appendChild(gameDesc);
  panel.appendChild(gameSection);

  // ---- Slow-tick (Live MCP) section ----
  const liveSection = document.createElement('div');
  liveSection.style.cssText = 'padding:14px 16px;border-bottom:1px solid #ddd;flex-shrink:0;';

  const liveToggleRow = document.createElement('div');
  liveToggleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';

  const liveLabel = document.createElement('div');
  liveLabel.style.cssText = 'font-weight:bold;font-size:0.85rem;color:#888;text-transform:uppercase;letter-spacing:0.5px;';
  liveLabel.textContent = 'Live MCP Mode';
  liveToggleRow.appendChild(liveLabel);

  let slowTickEnabled = false;
  const liveToggle = document.createElement('button');
  liveToggle.textContent = 'OFF';
  liveToggle.style.cssText = toggleBtnStyle(false);

  function updateLiveToggle(): void {
    liveToggle.textContent = slowTickEnabled ? 'ON' : 'OFF';
    liveToggle.style.cssText = toggleBtnStyle(slowTickEnabled);
    liveHint.style.display = slowTickEnabled ? 'block' : 'none';
    // Show/hide per-bot live checkboxes
    for (const cb of liveCheckboxes) cb.style.display = slowTickEnabled ? 'inline-flex' : 'none';
    // When slow-tick is on, override speed display
    for (const btn of speedBtns) btn.style.opacity = slowTickEnabled ? '0.4' : '1';
  }

  liveToggle.addEventListener('click', () => {
    slowTickEnabled = !slowTickEnabled;
    updateLiveToggle();
  });
  liveToggleRow.appendChild(liveToggle);
  liveSection.appendChild(liveToggleRow);

  const liveHint = document.createElement('div');
  liveHint.style.cssText = 'font-size:0.75rem;color:#668;margin-top:6px;display:none;line-height:1.4;';
  liveHint.textContent = 'Bots marked with a brain icon will pause on collision and wait for your MCP client to choose C or D. Connect via the MCP server.';
  liveSection.appendChild(liveHint);

  panel.appendChild(liveSection);

  // ---- Zombie section ----
  const zombieSection = document.createElement('div');
  zombieSection.style.cssText = 'padding:14px 16px;border-bottom:1px solid #ddd;flex-shrink:0;';

  const zombieLabel = document.createElement('div');
  zombieLabel.style.cssText = 'font-weight:bold;margin-bottom:8px;font-size:0.85rem;color:#888;text-transform:uppercase;letter-spacing:0.5px;';
  zombieLabel.textContent = 'Zombies';
  zombieSection.appendChild(zombieLabel);

  const zombieCounts = { shamblers: 0, infected: 0 };

  function createZombieRow(label: string, key: 'shamblers' | 'infected'): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 0;';

    const nameEl = document.createElement('span');
    nameEl.textContent = label;
    nameEl.style.cssText = 'flex:1;';
    row.appendChild(nameEl);

    const stepper = document.createElement('div');
    stepper.style.cssText = 'display:flex;align-items:center;gap:4px;flex-shrink:0;';

    const minus = document.createElement('button');
    minus.textContent = '−';
    minus.style.cssText = stepperBtnStyle();

    const countEl = document.createElement('span');
    countEl.style.cssText = 'display:inline-block;width:24px;text-align:center;font-size:0.9rem;font-variant-numeric:tabular-nums;';
    countEl.textContent = '0';

    const plus = document.createElement('button');
    plus.textContent = '+';
    plus.style.cssText = stepperBtnStyle();

    minus.addEventListener('click', () => {
      if (zombieCounts[key] <= 0) return;
      zombieCounts[key]--;
      countEl.textContent = String(zombieCounts[key]);
    });
    plus.addEventListener('click', () => {
      if (zombieCounts[key] >= 5) return;
      zombieCounts[key]++;
      countEl.textContent = String(zombieCounts[key]);
    });

    stepper.appendChild(minus);
    stepper.appendChild(countEl);
    stepper.appendChild(plus);
    row.appendChild(stepper);
    return row;
  }

  zombieSection.appendChild(createZombieRow('Shamblers (slow)', 'shamblers'));
  zombieSection.appendChild(createZombieRow('Infected (fast)', 'infected'));
  panel.appendChild(zombieSection);

  // ---- Bot selection section ----
  const botSection = document.createElement('div');
  botSection.style.cssText = 'padding:14px 16px;';

  const botHeader = document.createElement('div');
  botHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';

  const botLabel = document.createElement('div');
  botLabel.style.cssText = 'font-weight:bold;font-size:0.85rem;color:#aaa;text-transform:uppercase;letter-spacing:0.5px;';
  botHeader.appendChild(botLabel);

  const quickRow = document.createElement('div');
  quickRow.style.cssText = 'display:flex;gap:8px;';
  const allOneBtn = createTextBtn('All ×1');
  const clearBtn = createTextBtn('Clear');
  quickRow.appendChild(allOneBtn);
  quickRow.appendChild(clearBtn);
  botHeader.appendChild(quickRow);
  botSection.appendChild(botHeader);

  // Per-bot rows with −/+ steppers.
  const countDisplays: HTMLSpanElement[] = [];
  const liveCheckboxes: HTMLElement[] = [];
  const liveBotIds = new Set<string>();

  function totalBots(): number {
    let total = 0;
    for (const c of counts.values()) total += c;
    return total;
  }

  function updateSummary(): void {
    const total = totalBots();
    botLabel.textContent = `Bots (${total} total)`;
    startBtn.disabled = total < 2;
    startBtn.style.opacity = total < 2 ? '0.4' : '1';
  }

  allBots.forEach((bot, idx) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:5px 0;';

    const name = document.createElement('span');
    name.textContent = bot.name;
    name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:8px;';
    row.appendChild(name);

    // Live-bot toggle (brain icon, hidden unless slow-tick is on).
    const liveCb = document.createElement('button');
    liveCb.textContent = '\u{1F9E0}';
    liveCb.title = 'Toggle live MCP control for this bot';
    liveCb.style.cssText = 'all:unset;cursor:pointer;font-size:14px;margin-right:6px;opacity:0.3;display:none;' +
      'width:22px;height:22px;text-align:center;border-radius:4px;' +
      'align-items:center;justify-content:center;';
    liveCb.addEventListener('click', () => {
      if (liveBotIds.has(bot.id)) {
        liveBotIds.delete(bot.id);
        liveCb.style.opacity = '0.3';
        liveCb.style.background = 'transparent';
      } else {
        liveBotIds.add(bot.id);
        liveCb.style.opacity = '1';
        liveCb.style.background = 'rgba(100,180,255,0.2)';
      }
    });
    liveCheckboxes.push(liveCb);
    row.appendChild(liveCb);

    const stepper = document.createElement('div');
    stepper.style.cssText = 'display:flex;align-items:center;gap:4px;flex-shrink:0;';

    const minus = document.createElement('button');
    minus.textContent = '−';
    minus.style.cssText = stepperBtnStyle();

    const countEl = document.createElement('span');
    countEl.style.cssText = 'display:inline-block;width:24px;text-align:center;font-size:0.9rem;font-variant-numeric:tabular-nums;';
    countEl.textContent = String(counts.get(bot.id) ?? 0);
    countDisplays.push(countEl);

    const plus = document.createElement('button');
    plus.textContent = '+';
    plus.style.cssText = stepperBtnStyle();

    minus.addEventListener('click', () => {
      const cur = counts.get(bot.id) ?? 0;
      if (cur <= 0) return;
      counts.set(bot.id, cur - 1);
      countEl.textContent = String(cur - 1);
      updateSummary();
    });

    plus.addEventListener('click', () => {
      const cur = counts.get(bot.id) ?? 0;
      if (cur >= MAX_INSTANCES) return;
      counts.set(bot.id, cur + 1);
      countEl.textContent = String(cur + 1);
      updateSummary();
    });

    stepper.appendChild(minus);
    stepper.appendChild(countEl);
    stepper.appendChild(plus);
    row.appendChild(stepper);
    botSection.appendChild(row);
  });

  allOneBtn.addEventListener('click', () => {
    allBots.forEach((b, i) => {
      counts.set(b.id, 1);
      countDisplays[i]!.textContent = '1';
    });
    updateSummary();
  });
  clearBtn.addEventListener('click', () => {
    allBots.forEach((b, i) => {
      counts.set(b.id, 0);
      countDisplays[i]!.textContent = '0';
    });
    updateSummary();
  });

  panel.appendChild(botSection);

  // ---- Start button ----
  const footer = document.createElement('div');
  footer.style.cssText = 'padding:14px 16px;border-top:1px solid #ddd;flex-shrink:0;';

  const startBtn = document.createElement('button');
  startBtn.textContent = '▶ Start Arena';
  startBtn.style.cssText =
    'width:100%;padding:10px;border:none;border-radius:6px;' +
    'background:#2f6b4f;color:#fff;font:bold 14px/1 system-ui,sans-serif;' +
    'cursor:pointer;transition:background 0.15s;';
  startBtn.addEventListener('mouseenter', () => { if (!startBtn.disabled) startBtn.style.background = '#3a8562'; });
  startBtn.addEventListener('mouseleave', () => { startBtn.style.background = '#2f6b4f'; });
  startBtn.addEventListener('click', () => {
    if (totalBots() < 2) return;
    // Build flat array: repeat each BotRecord by its count.
    const roster: BotRecord[] = [];
    for (const bot of allBots) {
      const n = counts.get(bot.id) ?? 0;
      for (let i = 0; i < n; i++) roster.push(bot);
    }
    let config: ArenaConfig;
    if (slowTickEnabled) {
      config = { ...SLOW_TICK_CONFIG };
    } else {
      const preset = SPEED_PRESETS[currentSpeedIndex]!;
      config = {
        ...DEFAULT_CONFIG,
        speed: preset.speed,
        tickMs: preset.tick,
      };
    }
    closePanel();
    onStart(roster, config, { ...zombieCounts }, slowTickEnabled ? new Set(liveBotIds) : new Set(), selectedGameType, selectedLocation);
  });
  footer.appendChild(startBtn);
  panel.appendChild(footer);

  updateSummary();

  // ---- Open / close ----
  let isOpen = false;

  function openPanel(): void {
    panel.style.display = 'flex';
    gearBtn.style.display = 'none';
    isOpen = true;
  }
  function closePanel(): void {
    panel.style.display = 'none';
    gearBtn.style.display = 'block';
    isOpen = false;
  }

  gearBtn.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && isOpen) closePanel();
  };
  document.addEventListener('keydown', onKey);

  const el = document.createElement('div');
  el.appendChild(gearBtn);
  el.appendChild(panel);

  return {
    el,
    destroy() {
      document.removeEventListener('keydown', onKey);
      el.remove();
    },
  };
}

// ---- Helpers ----

function speedBtnStyle(active: boolean): string {
  return (
    'all:unset;cursor:pointer;padding:5px 10px;border-radius:4px;font-size:0.85rem;text-align:center;' +
    (active
      ? 'background:#5a6abf;color:#fff;'
      : 'background:rgba(0,0,0,0.06);color:#666;')
  );
}

function stepperBtnStyle(): string {
  return (
    'all:unset;cursor:pointer;width:24px;height:24px;border-radius:4px;' +
    'background:rgba(0,0,0,0.08);color:#555;font-size:14px;' +
    'display:inline-flex;align-items:center;justify-content:center;'
  );
}

function toggleBtnStyle(on: boolean): string {
  return (
    'all:unset;cursor:pointer;padding:4px 12px;border-radius:4px;font-size:0.8rem;font-weight:bold;' +
    (on
      ? 'background:#5a6abf;color:#fff;'
      : 'background:rgba(0,0,0,0.06);color:#888;')
  );
}

function gameBtnStyle(active: boolean): string {
  return (
    'all:unset;cursor:pointer;padding:6px 10px;border-radius:4px;font-size:0.8rem;' +
    (active
      ? 'background:#5a6abf;color:#fff;'
      : 'background:rgba(0,0,0,0.06);color:#666;')
  );
}

function createTextBtn(text: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText =
    'all:unset;cursor:pointer;font-size:0.8rem;color:#4a7abf;text-decoration:underline;';
  return btn;
}
