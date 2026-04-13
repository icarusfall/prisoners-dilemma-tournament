import type { BotSpec } from '../types.js';

/**
 * Joss (a.k.a. "Sneaky TFT"). Submitted by Johann Joss to Axelrod's
 * original 1980 tournament. Behaves like Tit for Tat but randomly
 * defects ~10% of the time when it would otherwise cooperate.
 *
 * This is the classic "mostly cooperate, occasionally defect" strategy
 * that exposes the brittleness of GRIM Trigger — one random defection
 * triggers GRIM's permanent retaliation, dragging both into mutual
 * defection. TFT handles Joss much better: it retaliates once, Joss
 * (usually) cooperates next round, and they recover.
 */
export const JOSS: BotSpec = {
  name: 'Joss',
  version: 1,
  kind: 'dsl',
  initial: { type: 'move', move: 'C' },
  rules: [
    {
      comment: 'If they defected last round, always retaliate (like TFT).',
      when: { type: 'opponentLastMove', equals: 'D' },
      do: { type: 'move', move: 'D' },
    },
    {
      comment: '10% chance of a sneaky defection even when they cooperated.',
      when: { type: 'random', op: 'lt', value: 0.1 },
      do: { type: 'move', move: 'D' },
    },
  ],
  default: { type: 'move', move: 'C' },
};
