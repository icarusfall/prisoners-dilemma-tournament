import type { BotSpec } from '../types.js';

/**
 * Prober (a.k.a. "Tester"). Cooperates on round 0, then defects on
 * rounds 1 and 2 to test the opponent's response.
 *
 *   - If the opponent never defected during the probe (cooperated on
 *     rounds 0, 1, and 2), Prober concludes they're exploitable and
 *     defects for the rest of the game.
 *   - If the opponent retaliated at least once, Prober cooperates on
 *     round 3 (a "peace offering" to reset), then plays Tit for Tat.
 *
 * A classic Axelrod-era strategy that mostly cooperates against
 * retaliators but exploits pushovers. The initial defection probes
 * trigger GRIM into permanent retaliation (costly for both sides),
 * while TFT recovers after the probe and settles into mutual
 * cooperation.
 */
export const PROBER: BotSpec = {
  name: 'Prober',
  version: 1,
  kind: 'dsl',
  initial: { type: 'move', move: 'C' },
  rules: [
    {
      comment: 'Defect on rounds 1 and 2 (the probe).',
      when: {
        type: 'and',
        of: [
          { type: 'round', op: 'gte', value: 1 },
          { type: 'round', op: 'lte', value: 2 },
        ],
      },
      do: { type: 'move', move: 'D' },
    },
    {
      comment: 'Round 3: if opponent never defected, they are exploitable — start exploiting.',
      when: {
        type: 'and',
        of: [
          { type: 'round', op: 'eq', value: 3 },
          { type: 'opponentDefectionRate', op: 'eq', value: 0 },
        ],
      },
      do: { type: 'move', move: 'D' },
    },
    {
      comment: 'Round 3: opponent retaliated — cooperate as a peace offering to reset.',
      when: { type: 'round', op: 'eq', value: 3 },
      do: { type: 'move', move: 'C' },
    },
    {
      comment: 'After the probe: if opponent has never defected, keep exploiting.',
      when: {
        type: 'and',
        of: [
          { type: 'round', op: 'gt', value: 3 },
          { type: 'opponentDefectionRate', op: 'eq', value: 0 },
        ],
      },
      do: { type: 'move', move: 'D' },
    },
    {
      comment: 'Otherwise fall back to TFT: retaliate if they defected last round.',
      when: { type: 'opponentLastMove', equals: 'D' },
      do: { type: 'move', move: 'D' },
    },
  ],
  default: { type: 'move', move: 'C' },
};
