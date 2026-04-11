import type { BotSpec } from '../types.js';

/**
 * Tit for Two Tats. A more forgiving cousin of TFT — only retaliates
 * after the opponent defects on **two consecutive** rounds. This makes
 * it robust against echo-effect death spirals between two TFT-like
 * strategies whose first defection was a noise glitch.
 */
export const TF2T: BotSpec = {
  name: 'Tit for Two Tats',
  version: 1,
  kind: 'dsl',
  initial: { type: 'move', move: 'C' },
  rules: [
    {
      comment: 'Defect only after two consecutive opponent defections.',
      when: {
        type: 'patternInLastN',
        side: 'opponent',
        n: 2,
        pattern: ['D', 'D'],
      },
      do: { type: 'move', move: 'D' },
    },
  ],
  default: { type: 'move', move: 'C' },
};
