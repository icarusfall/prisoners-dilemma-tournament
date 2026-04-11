import type { BotSpec } from '../types.js';

/**
 * Tit for Tat. Anatol Rapoport's submission to the original
 * Axelrod 1980 tournament — the simplest "nice, retaliatory, forgiving,
 * and clear" strategy and the surprise winner of both Axelrod rounds.
 *
 * Cooperate on round 0; thereafter copy the opponent's previous move.
 */
export const TFT: BotSpec = {
  name: 'Tit for Tat',
  version: 1,
  kind: 'dsl',
  initial: { type: 'move', move: 'C' },
  rules: [
    {
      comment: 'If they defected last round, retaliate once.',
      when: { type: 'opponentLastMove', equals: 'D' },
      do: { type: 'move', move: 'D' },
    },
  ],
  default: { type: 'move', move: 'C' },
};
