// Match runner — plays a single iterated PD match between two bot
// instances and returns a fully-recorded `MatchResult`.
//
// Determinism contract (architecture §3.3):
//   playMatch(a, b, rounds, seed) → identical output for identical input.
//
// Each instance receives its OWN PRNG, derived from `(matchSeed,
// instanceIndex)` via `deriveInstanceSeed`. This means:
//   • A bot's random draws cannot influence its opponent's draws.
//   • Swapping the order of instances in the argument list still gives
//     reproducible (though distinct) per-instance RNG streams.
//   • Replays from `(seed, a, b, rounds)` always reproduce exactly.
//
// History is built up round by round and threaded into each bot's
// `BotView` from its own perspective (myMoves / theirMoves are mirrored
// per side).

import type { BotInstance, BotView, MatchResult, Move, RoundResult } from './types.js';
import { scoreRound, type Payoffs } from './scoring.js';
import { deriveInstanceSeed, mulberry32 } from './rng.js';

export interface PlayMatchOptions {
  /** Identifier to embed in the returned `MatchResult.matchId`. */
  matchId?: string;
  /**
   * If true, the actual number of rounds is drawn from [0.8×rounds,
   * 1.2×rounds] using the match seed, so bots can never predict the
   * last round. Deterministic given `(seed, rounds)`.
   */
  noisyEnding?: boolean;
  /** Custom payoff matrix. Defaults to the standard PD payoffs. */
  payoffs?: Payoffs;
}

/**
 * Play a single iterated PD match between two bot instances.
 *
 * Pure given `(a, b, rounds, seed)`. The two instances see independent
 * RNG streams derived from the match seed.
 */
export function playMatch(
  a: BotInstance,
  b: BotInstance,
  rounds: number,
  seed: number,
  options: PlayMatchOptions = {},
): MatchResult {
  if (!Number.isInteger(rounds) || rounds <= 0) {
    throw new Error(`playMatch: rounds must be a positive integer, got ${rounds}`);
  }

  // Noisy ending: draw actual round count from [0.8×rounds, 1.2×rounds]
  // using a dedicated RNG stream so it doesn't perturb the bots' draws.
  let actualRounds = rounds;
  if (options.noisyEnding) {
    const noiseRng = mulberry32(deriveInstanceSeed(seed, 99));
    const lo = Math.max(1, Math.floor(rounds * 0.8));
    const hi = Math.ceil(rounds * 1.2);
    actualRounds = lo + Math.floor(noiseRng() * (hi - lo + 1));
  }

  const rngA = mulberry32(deriveInstanceSeed(seed, 0));
  const rngB = mulberry32(deriveInstanceSeed(seed, 1));

  // Mutable per-side history. We hand the bot a frozen view each round
  // so it can never mutate the engine's state, but we mutate ours.
  const movesA: Move[] = [];
  const movesB: Move[] = [];
  const roundResults: RoundResult[] = [];
  let totalA = 0;
  let totalB = 0;

  for (let r = 0; r < actualRounds; r++) {
    const viewA: BotView = {
      selfInstanceId: a.instanceId,
      opponentInstanceId: b.instanceId,
      round: r,
      history: { myMoves: movesA, theirMoves: movesB },
      rng: rngA,
    };
    const viewB: BotView = {
      selfInstanceId: b.instanceId,
      opponentInstanceId: a.instanceId,
      round: r,
      history: { myMoves: movesB, theirMoves: movesA },
      rng: rngB,
    };

    const moveA = a.decide(viewA);
    const moveB = b.decide(viewB);

    const result = scoreRound(moveA, moveB, options.payoffs);
    roundResults.push(result);
    totalA += result.scoreA;
    totalB += result.scoreB;

    movesA.push(moveA);
    movesB.push(moveB);
  }

  return {
    matchId: options.matchId ?? `${a.instanceId}-vs-${b.instanceId}-${seed}`,
    instanceA: a.instanceId,
    instanceB: b.instanceId,
    rounds: roundResults,
    totalA,
    totalB,
    seed,
  };
}
