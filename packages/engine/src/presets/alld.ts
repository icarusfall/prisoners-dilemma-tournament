import type { BotSpec } from '../types.js';

/**
 * Always Defect. The dominant strategy in a one-shot Prisoner's Dilemma
 * and the bogeyman of the iterated game — exploits any unconditional
 * cooperator and never gets exploited itself.
 */
export const ALLD: BotSpec = {
  name: 'Always Defect',
  version: 1,
  kind: 'dsl',
  initial: { type: 'move', move: 'D' },
  rules: [],
  default: { type: 'move', move: 'D' },
};
