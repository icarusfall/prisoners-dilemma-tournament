import type { BotSpec } from '../types.js';

/**
 * Always Cooperate. Plays C every round, no matter what. The simplest
 * cooperator and the canonical victim of any defector — used in the
 * shared library so newcomers can see how a strategy gets exploited.
 */
export const ALLC: BotSpec = {
  name: 'Always Cooperate',
  version: 1,
  kind: 'dsl',
  initial: { type: 'move', move: 'C' },
  rules: [],
  default: { type: 'move', move: 'C' },
};
