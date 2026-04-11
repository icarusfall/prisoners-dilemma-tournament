import type { BotSpec } from '../types.js';

/**
 * Generous Tit for Tat. Like TFT, but forgives ~10% of opponent
 * defections by cooperating anyway. Nowak & Sigmund showed this is
 * strictly better than plain TFT in noisy environments because it can
 * break the echo-chain of mutual retaliation that two TFT-like
 * strategies can fall into after a single misstep.
 *
 * Implemented as a stochastic action: after an opponent D, draw from
 * `{ C: 1, D: 9 }` so we cooperate with probability 0.1.
 */
export const GENEROUS_TFT: BotSpec = {
  name: 'Generous Tit for Tat',
  version: 1,
  kind: 'dsl',
  initial: { type: 'move', move: 'C' },
  rules: [
    {
      comment: 'After an opponent defection, retaliate 90% of the time.',
      when: { type: 'opponentLastMove', equals: 'D' },
      do: { type: 'random', weights: { C: 1, D: 9 } },
    },
  ],
  default: { type: 'move', move: 'C' },
};
