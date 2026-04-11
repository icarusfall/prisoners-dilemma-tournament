// Scoring for a single Prisoner's Dilemma round.
//
// Classic Axelrod-faithful payoff matrix:
//
//                  Opponent C    Opponent D
//      Me C            R=3            S=0
//      Me D            T=5            P=1
//
// For the dilemma to be a "true" iterated PD the constants must satisfy
//   T > R > P > S       (defection is always individually tempting)
//   2R > T + S          (mutual cooperation beats alternating exploitation)
// Both checks live as runtime tests in test/scoring.test.ts.

import type { Move, RoundResult } from './types.js';

export const PAYOFFS = {
  /** Reward for mutual cooperation. */
  R: 3,
  /** Punishment for mutual defection. */
  P: 1,
  /** Temptation: sole defector against a cooperator. */
  T: 5,
  /** Sucker: sole cooperator against a defector. */
  S: 0,
} as const;

/** Score a single round given both players' moves. */
export function scoreRound(moveA: Move, moveB: Move): RoundResult {
  const { R, P, T, S } = PAYOFFS;
  if (moveA === 'C' && moveB === 'C') return { moveA, moveB, scoreA: R, scoreB: R };
  if (moveA === 'D' && moveB === 'D') return { moveA, moveB, scoreA: P, scoreB: P };
  if (moveA === 'D' && moveB === 'C') return { moveA, moveB, scoreA: T, scoreB: S };
  return { moveA, moveB, scoreA: S, scoreB: T };
}
