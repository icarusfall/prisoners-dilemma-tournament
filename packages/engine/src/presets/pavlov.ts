import type { BotSpec } from '../types.js';

/**
 * Pavlov (a.k.a. Win-Stay, Lose-Shift). Cooperates on round 0, then
 * after each round:
 *   - if the last round was a *win* (R = mutual coop, or T = I defected
 *     while they cooperated), repeat my last move
 *   - if the last round was a *loss* (P = mutual defection, or S = I
 *     cooperated while they defected), switch
 *
 * Equivalent to: play C iff `myLastMove === opponentLastMove`. CC and
 * DD both keep us in sync (so we play C); CD and DC both want to break
 * the asymmetry (so we play D).
 *
 * Pavlov is a famously strong evolutionary strategy — Nowak & Sigmund
 * 1993 — because it punishes defectors *and* recovers from accidental
 * defections, unlike GRIM.
 */
export const PAVLOV: BotSpec = {
  name: 'Pavlov',
  version: 1,
  kind: 'dsl',
  initial: { type: 'move', move: 'C' },
  rules: [
    {
      comment: 'CC last round → cooperate (win-stay).',
      when: {
        type: 'and',
        of: [
          { type: 'myLastMove', equals: 'C' },
          { type: 'opponentLastMove', equals: 'C' },
        ],
      },
      do: { type: 'move', move: 'C' },
    },
    {
      comment: 'DD last round → cooperate (lose-shift from D to C).',
      when: {
        type: 'and',
        of: [
          { type: 'myLastMove', equals: 'D' },
          { type: 'opponentLastMove', equals: 'D' },
        ],
      },
      do: { type: 'move', move: 'C' },
    },
  ],
  // CD or DC last round → defect (asymmetric outcome → break it).
  default: { type: 'move', move: 'D' },
};
