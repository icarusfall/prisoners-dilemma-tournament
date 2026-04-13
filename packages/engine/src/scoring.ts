// Scoring for a single round of a 2×2 symmetric game.
//
// The classic Prisoner's Dilemma payoff matrix:
//
//                  Opponent C    Opponent D
//      Me C            R=3            S=0
//      Me D            T=5            P=1
//
// All four classic 2×2 symmetric games reorder the same four payoffs
// (T, R, P, S). The engine supports switching between them via a
// `Payoffs` object — bots still choose C or D, only the scoring changes.

import type { Move, RoundResult } from './types.js';

/** The four payoff values for a 2×2 symmetric game. */
export interface Payoffs {
  /** Reward for mutual cooperation. */
  R: number;
  /** Punishment for mutual defection. */
  P: number;
  /** Temptation: sole defector against a cooperator. */
  T: number;
  /** Sucker: sole cooperator against a defector. */
  S: number;
}

/** Supported game types. */
export type GameType = 'prisoners-dilemma' | 'chicken' | 'stag-hunt' | 'deadlock';

/** Preset payoff matrices for the four classic 2×2 symmetric games. */
export const GAME_TYPES: Record<GameType, { label: string; description: string; payoffs: Payoffs }> = {
  'prisoners-dilemma': {
    label: "Prisoner's Dilemma",
    description: 'T > R > P > S — defection tempts, but mutual cooperation pays best over time.',
    payoffs: { R: 3, P: 1, T: 5, S: 0 },
  },
  'chicken': {
    label: 'Chicken (Hawk-Dove)',
    description: 'T > R > S > P — mutual defection is the worst outcome (head-on crash).',
    payoffs: { R: 3, P: 0, T: 5, S: 1 },
  },
  'stag-hunt': {
    label: 'Stag Hunt',
    description: 'R > T > P > S — mutual cooperation is the best, but risky if partner defects.',
    payoffs: { R: 4, P: 1, T: 3, S: 0 },
  },
  'deadlock': {
    label: 'Deadlock',
    description: 'T > P > R > S — defection always dominates; cooperation is irrational.',
    payoffs: { R: 1, P: 3, T: 5, S: 0 },
  },
};

/** The default PD payoffs — backwards-compatible constant. */
export const PAYOFFS: Payoffs = GAME_TYPES['prisoners-dilemma'].payoffs;

/** Score a single round given both players' moves and an optional payoff matrix. */
export function scoreRound(moveA: Move, moveB: Move, payoffs: Payoffs = PAYOFFS): RoundResult {
  const { R, P, T, S } = payoffs;
  if (moveA === 'C' && moveB === 'C') return { moveA, moveB, scoreA: R, scoreB: R };
  if (moveA === 'D' && moveB === 'D') return { moveA, moveB, scoreA: P, scoreB: P };
  if (moveA === 'D' && moveB === 'C') return { moveA, moveB, scoreA: T, scoreB: S };
  return { moveA, moveB, scoreA: S, scoreB: T };
}
