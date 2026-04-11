import type { BotSpec } from '../types.js';

/**
 * Random. Plays C or D with equal probability on every round,
 * including round 0. Useful as a noise floor and as the textbook
 * example of a strategy with no memory or model of the opponent.
 *
 * Determinism within a single run still holds because the engine
 * seeds each instance's RNG from `(seed, instanceIndex)`.
 */
export const RANDOM: BotSpec = {
  name: 'Random',
  version: 1,
  kind: 'dsl',
  initial: { type: 'random', weights: { C: 1, D: 1 } },
  rules: [],
  default: { type: 'random', weights: { C: 1, D: 1 } },
};
