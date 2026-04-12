// Bot info side panel — click-a-sprite inspector.
//
// Slides in from the right when a bot sprite is clicked. Shows:
//   - Bot name, strategy, colour swatch
//   - Current score and rank
//   - Per-opponent match history breakdown
//
// The panel reads from live ArenaBot[] and PairState map references
// so it always reflects the current simulation state.

import type { ArenaBot, PairState } from './types.js';
import { pairKey } from './types.js';
import { colourFor } from '../palette.js';
import { SPRITE_NAMES } from './sprites/index.js';
import type { Action, Condition, Rule } from '@pdt/engine';

// ---------------------------------------------------------------------
// Panel DOM
// ---------------------------------------------------------------------

const PANEL_WIDTH = 300;

export interface SidePanel {
  /** The panel root element (append to your wrapper). */
  el: HTMLElement;
  /** Show the panel for a given bot. */
  open(instanceId: string): void;
  /** Close the panel. */
  close(): void;
  /** Refresh content (call each frame or on a slower interval). */
  refresh(): void;
  /** Currently selected instanceId, or null. */
  selectedId(): string | null;
}

export function createSidePanel(
  getBots: () => ArenaBot[],
  getPairs: () => Map<string, PairState>,
): SidePanel {
  let selectedInstanceId: string | null = null;

  // ---- Root element ----
  const el = document.createElement('div');
  el.style.cssText =
    `position:absolute;top:0;right:0;bottom:0;width:${PANEL_WIDTH}px;` +
    'background:rgba(10,10,20,0.92);color:#ddd;font:13px/1.5 system-ui,sans-serif;' +
    'overflow-y:auto;z-index:15;transform:translateX(100%);transition:transform 0.25s ease;' +
    'padding:0;box-shadow:-2px 0 12px rgba(0,0,0,0.5);';

  // ---- Close button ----
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '\u00d7';
  closeBtn.style.cssText =
    'position:sticky;top:0;float:right;background:none;border:none;color:#999;' +
    'font-size:22px;cursor:pointer;padding:8px 12px;z-index:1;';
  closeBtn.addEventListener('click', () => close());

  // ---- Content area ----
  const content = document.createElement('div');
  content.style.cssText = 'padding:12px 16px;';

  el.appendChild(closeBtn);
  el.appendChild(content);

  // ---- Open / close ----
  function open(instanceId: string): void {
    selectedInstanceId = instanceId;
    el.style.transform = 'translateX(0)';
    refresh();
  }

  function close(): void {
    selectedInstanceId = null;
    el.style.transform = 'translateX(100%)';
  }

  function selectedId(): string | null {
    return selectedInstanceId;
  }

  // ---- Refresh ----
  function refresh(): void {
    if (!selectedInstanceId) return;

    const bots = getBots();
    const bot = bots.find((b) => b.instanceId === selectedInstanceId);
    if (!bot) {
      content.innerHTML = '<p style="color:#888;">Bot no longer in arena.</p>';
      return;
    }

    const pairs = getPairs();
    const rank = [...bots].sort((a, b) => b.score - a.score).findIndex((b) => b.instanceId === bot.instanceId) + 1;
    const colour = colourFor(bot.botId, 0);
    const spriteName = SPRITE_NAMES[bot.spriteVariant % SPRITE_NAMES.length] ?? 'unknown';

    // ---- Header ----
    let html = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <div style="width:14px;height:14px;border-radius:50%;background:${colour};flex-shrink:0;"></div>
        <div>
          <div style="font-weight:bold;font-size:15px;">${esc(bot.name)}</div>
          <div style="color:#888;font-size:11px;">${esc(spriteName)} · ${esc(bot.botId)}</div>
        </div>
      </div>
    `;

    // ---- Score ----
    html += `
      <div style="display:flex;gap:16px;margin-bottom:14px;">
        <div><span style="color:#888;">Score</span><br><strong>${bot.score}</strong></div>
        <div><span style="color:#888;">Rank</span><br><strong>#${rank}</strong> of ${bots.length}</div>
      </div>
    `;

    // ---- Strategy summary ----
    html += `
      <div style="margin-bottom:14px;">
        <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Strategy</div>
        <div style="font-size:12px;line-height:1.5;background:rgba(255,255,255,0.04);padding:8px 10px;border-radius:4px;">
          ${summariseStrategy(bot)}
        </div>
      </div>
    `;

    // ---- Per-opponent history ----
    const opponents = bots.filter((b) => b.instanceId !== bot.instanceId);
    if (opponents.length > 0) {
      html += `
        <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Opponents</div>
      `;
      for (const opp of opponents) {
        const key = pairKey(bot.instanceId, opp.instanceId);
        const pair = pairs.get(key);
        const isFirst = bot.instanceId < opp.instanceId;
        const myMoves = pair ? (isFirst ? pair.movesA : pair.movesB) : [];
        const theirMoves = pair ? (isFirst ? pair.movesB : pair.movesA) : [];
        const rounds = myMoves.length;
        const myCoops = myMoves.filter((m) => m === 'C').length;
        const theirCoops = theirMoves.filter((m) => m === 'C').length;
        const oppColour = colourFor(opp.botId, 0);

        html += `
          <div style="margin-bottom:8px;padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:4px;border-left:3px solid ${oppColour};">
            <div style="font-weight:bold;font-size:12px;">${esc(opp.name)}</div>
        `;

        if (rounds === 0) {
          html += `<div style="color:#666;font-size:11px;">No encounters yet</div>`;
        } else {
          const myRate = Math.round((myCoops / rounds) * 100);
          const theirRate = Math.round((theirCoops / rounds) * 100);
          html += `
            <div style="font-size:11px;color:#aaa;">
              ${rounds} round${rounds > 1 ? 's' : ''} ·
              Me: ${myRate}% C · Them: ${theirRate}% C
            </div>
            <div style="margin-top:3px;display:flex;gap:1px;flex-wrap:wrap;">
              ${myMoves.map((m, i) => {
                const their = theirMoves[i];
                const bg = m === 'C' && their === 'C' ? '#2a5a2a'
                  : m === 'D' && their === 'D' ? '#5a2a2a'
                  : '#4a4a2a';
                const label = `${m}/${their}`;
                return `<div title="R${i + 1}: ${label}" style="width:10px;height:10px;background:${bg};border-radius:1px;"></div>`;
              }).join('')}
            </div>
          `;
        }
        html += `</div>`;
      }
    }

    content.innerHTML = html;
  }

  return { el, open, close, refresh, selectedId };
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function actionLabel(action: Action): string {
  if (action.type === 'move') return action.move === 'C' ? 'Cooperate' : 'Defect';
  const total = action.weights.C + action.weights.D;
  if (total === 0) return 'Random';
  const pC = Math.round((action.weights.C / total) * 100);
  return `${pC}% C / ${100 - pC}% D`;
}

function conditionLabel(cond: Condition): string {
  switch (cond.type) {
    case 'always': return 'always';
    case 'opponentLastMove': return `opponent last played ${cond.equals}`;
    case 'myLastMove': return `I last played ${cond.equals}`;
    case 'round': return `round ${cond.op} ${cond.value}`;
    case 'classifyOpponent': return `opponent looks like ${cond.equals}`;
    case 'opponentDefectionRate': return `opp defection rate ${cond.op} ${cond.value}${cond.window ? ` (last ${cond.window})` : ''}`;
    case 'opponentCooperationRate': return `opp coop rate ${cond.op} ${cond.value}${cond.window ? ` (last ${cond.window})` : ''}`;
    case 'random': return `random ${cond.op} ${cond.value}`;
    case 'and': return cond.of.map(conditionLabel).join(' AND ');
    case 'or': return cond.of.map(conditionLabel).join(' OR ');
    case 'not': return `NOT (${conditionLabel(cond.of)})`;
    default: return cond.type;
  }
}

function summariseStrategy(bot: ArenaBot): string {
  const spec = bot.spec;
  const lines: string[] = [];
  lines.push(`<b>Opens:</b> ${actionLabel(spec.initial)}`);

  const maxRules = 4;
  const rules = spec.rules.slice(0, maxRules);
  for (const rule of rules) {
    const comment = rule.comment ? `<span style="color:#888;"> // ${esc(rule.comment)}</span>` : '';
    lines.push(`If ${esc(conditionLabel(rule.when))} → ${actionLabel(rule.do)}${comment}`);
  }
  if (spec.rules.length > maxRules) {
    lines.push(`<span style="color:#888;">…and ${spec.rules.length - maxRules} more rule${spec.rules.length - maxRules > 1 ? 's' : ''}</span>`);
  }
  lines.push(`<b>Default:</b> ${actionLabel(spec.default)}`);
  return lines.join('<br>');
}
