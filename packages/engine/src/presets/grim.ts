import type { BotSpec } from '../types.js';

/**
 * Grim Trigger. Cooperates until the opponent defects *even once*,
 * then defects forever after. The most unforgiving "nice" strategy:
 * one slip and the relationship is dead.
 *
 * Implemented via `longestRun` over the opponent's history — once
 * they have ever produced a run of D ≥ 1, the rule fires for the rest
 * of the match.
 */
export const GRIM: BotSpec = {
  name: 'Grim Trigger',
  version: 1,
  kind: 'dsl',
  initial: { type: 'move', move: 'C' },
  rules: [
    {
      comment: 'Once the opponent has ever defected, defect forever.',
      when: {
        type: 'longestRun',
        side: 'opponent',
        move: 'D',
        op: 'gte',
        value: 1,
      },
      do: { type: 'move', move: 'D' },
    },
  ],
  default: { type: 'move', move: 'C' },
};
