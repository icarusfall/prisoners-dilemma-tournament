// Evolutionary tournament runner — strategy-distribution mode with
// replicator (or fitness-proportional) selection.
//
// This is the headline non-trivial mode. The population is represented
// as a *distribution over strategies*, not a bag of individuals — so
// the cost is `O(k²)` per generation regardless of how many notional
// individuals are in the pool. We can run hundreds of generations of
// the eight classical strategies in milliseconds.
//
// One generation:
//   1. For every unordered pair (i, j) — including i == j — play one
//      `playMatch` and record per-strategy scores.
//   2. fitness_i = Σ_j share_j × score(i vs j)
//      i.e. the expected score of an i-individual against a random
//      member of the current population.
//   3. Update shares via the selection rule:
//        replicator   : share_i' = share_i × fitness_i / mean_fitness
//        proportional : share_i' = fitness_i / Σ_j fitness_j
//      Replicator (default) is the classical Hamilton/Maynard-Smith
//      form and matches Axelrod-Hamilton 1981. Proportional is the
//      simpler "fitness rules absolutely" alternative.
//   4. Apply the extinction threshold and renormalise.
//   5. Record the generation and repeat.
//
// `generation1Winner` is computed from the *non-self-play* totals in
// generation 1 so it matches a strict Axelrod-faithful round-robin —
// the field is the classical "who scored highest in a one-shot
// tournament" answer. `dominanceWinner` is the strategy with the
// largest population share at the end of the run; in many pools
// (notably {TFT, ALLD, ALLC}) those two answers disagree, which is
// the entire point of the evolutionary view.
//
// See architecture.md §3.6.

import type {
  BotInstance,
  BotSpec,
  EvolutionaryResult,
  Generation,
  LeaderboardEntry,
} from './types.js';
import { compile } from './interpreter.js';
import { playMatch } from './match.js';
import { pairSeed } from './tournament.js';
import type { GameType, Payoffs } from './scoring.js';
import { GAME_TYPES } from './scoring.js';

export interface EvolutionaryEntry {
  /** Stable identifier; appears in `population`, `fitness`, leaderboards. */
  botId: string;
  spec: BotSpec;
  /**
   * Initial weight in the population. May be a count (e.g. 10) or a
   * fraction (e.g. 0.33) — the runner normalises internally and uses
   * `preserveTotal` to decide how to report shares back out.
   */
  initialShare: number;
}

export interface RunEvolutionaryOptions {
  /** Selection rule. Default `'replicator'`. */
  selection?: 'replicator' | 'proportional';
  /**
   * If true (default), generation populations are reported scaled to
   * the original total weight, e.g. `{ tft: 12.4, alld: 3.6, ... }`.
   * If false, populations are reported as normalised shares summing
   * to 1.
   */
  preserveTotal?: boolean;
  /**
   * Strategies whose share falls below this threshold are removed
   * (set to 0) at the end of the generation. Default 0.01.
   */
  extinctionThreshold?: number;
  /** If true, each match's round count varies by ±20% so bots can't predict the last round. */
  noisyEnding?: boolean;
  /** Game type — determines the payoff matrix. Default: prisoners-dilemma. */
  gameType?: GameType;
}

const DEFAULT_EXTINCTION_THRESHOLD = 0.01;

/**
 * Run an evolutionary tournament. Pure given
 * `(entries, roundsPerMatch, generations, seed, options)`.
 */
export function runEvolutionaryTournament(
  entries: EvolutionaryEntry[],
  roundsPerMatch: number,
  generations: number,
  seed: number,
  options: RunEvolutionaryOptions = {},
): EvolutionaryResult {
  if (!Number.isInteger(roundsPerMatch) || roundsPerMatch <= 0) {
    throw new Error(
      `runEvolutionaryTournament: roundsPerMatch must be a positive integer, got ${roundsPerMatch}`,
    );
  }
  if (!Number.isInteger(generations) || generations <= 0) {
    throw new Error(
      `runEvolutionaryTournament: generations must be a positive integer, got ${generations}`,
    );
  }
  if (entries.length < 2) {
    throw new Error(
      `runEvolutionaryTournament: need at least 2 entries, got ${entries.length}`,
    );
  }
  const seenIds = new Set<string>();
  for (const e of entries) {
    if (seenIds.has(e.botId)) {
      throw new Error(`runEvolutionaryTournament: duplicate botId "${e.botId}"`);
    }
    if (e.initialShare < 0) {
      throw new Error(
        `runEvolutionaryTournament: negative initialShare for "${e.botId}"`,
      );
    }
    seenIds.add(e.botId);
  }
  const initialTotal = entries.reduce((s, e) => s + e.initialShare, 0);
  if (initialTotal <= 0) {
    throw new Error(
      'runEvolutionaryTournament: total initial population must be positive',
    );
  }

  const selection = options.selection ?? 'replicator';
  const preserveTotal = options.preserveTotal ?? true;
  const extinctionThreshold =
    options.extinctionThreshold ?? DEFAULT_EXTINCTION_THRESHOLD;
  const noisyEnding = options.noisyEnding ?? false;
  const gameType: GameType = options.gameType ?? 'prisoners-dilemma';
  const payoffs: Payoffs = GAME_TYPES[gameType].payoffs;

  const k = entries.length;
  const decideFns = entries.map((e) => compile(e.spec));

  // Normalised population shares (always sum to 1 internally).
  const shares: number[] = entries.map((e) => e.initialShare / initialTotal);
  const extinctEver = new Set<string>();
  const generationsOut: Generation[] = [];

  for (let g = 0; g < generations; g++) {
    // ---- 1. play every alive pairwise match (including self-play) ----
    const score: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    const isAlive = (i: number): boolean => shares[i]! > 0;

    for (let i = 0; i < k; i++) {
      if (!isAlive(i)) continue;
      for (let j = i; j < k; j++) {
        if (!isAlive(j)) continue;
        const ms = generationPairSeed(seed, g, i, j);
        const a: BotInstance = {
          instanceId: `${entries[i]!.botId}#a`,
          botId: entries[i]!.botId,
          spec: entries[i]!.spec,
          decide: decideFns[i]!,
        };
        const b: BotInstance = {
          instanceId: `${entries[j]!.botId}#b`,
          botId: entries[j]!.botId,
          spec: entries[j]!.spec,
          decide: decideFns[j]!,
        };
        const result = playMatch(a, b, roundsPerMatch, ms, { noisyEnding, payoffs });
        if (i === j) {
          // Self-play: average both halves so a stochastic strategy
          // doesn't asymmetrically reward whichever side rolled luckier.
          score[i]![i] = (result.totalA + result.totalB) / 2;
        } else {
          score[i]![j] = result.totalA;
          score[j]![i] = result.totalB;
        }
      }
    }

    // ---- 2. fitness = Σ_j share_j × score[i][j] (includes self) ----
    const fitness: number[] = new Array<number>(k).fill(0);
    for (let i = 0; i < k; i++) {
      if (!isAlive(i)) continue;
      let f = 0;
      for (let j = 0; j < k; j++) {
        if (!isAlive(j)) continue;
        f += shares[j]! * score[i]![j]!;
      }
      fitness[i] = f;
    }

    // ---- gen leaderboard from non-self-play totals (Axelrod-faithful) ----
    const leaderboard = buildEvoLeaderboard(entries, score, isAlive);

    // ---- 3. update shares via the selected rule ----
    const newShares = updateShares(shares, fitness, selection, isAlive);

    // ---- 4. apply extinction & renormalise ----
    let totalAfter = 0;
    for (let i = 0; i < k; i++) {
      if (newShares[i]! > 0 && newShares[i]! < extinctionThreshold) {
        extinctEver.add(entries[i]!.botId);
        newShares[i] = 0;
      }
      totalAfter += newShares[i]!;
    }
    if (totalAfter > 0) {
      for (let i = 0; i < k; i++) newShares[i] = newShares[i]! / totalAfter;
    }

    // ---- 5. record this generation (use *current* shares, not new) ----
    const populationOut: Record<string, number> = {};
    const fitnessOut: Record<string, number> = {};
    for (let i = 0; i < k; i++) {
      const id = entries[i]!.botId;
      populationOut[id] = preserveTotal ? shares[i]! * initialTotal : shares[i]!;
      fitnessOut[id] = fitness[i]!;
    }
    generationsOut.push({
      index: g,
      population: populationOut,
      fitness: fitnessOut,
      leaderboard,
    });

    // Advance.
    for (let i = 0; i < k; i++) shares[i] = newShares[i]!;
  }

  // ---- generation1Winner: top of the gen-0 (Axelrod-faithful) leaderboard ----
  const gen1Lb = generationsOut[0]!.leaderboard;
  const generation1Winner = gen1Lb[0]!.botId;

  // ---- dominanceWinner: largest share at the end ----
  const finalGen = generationsOut[generationsOut.length - 1]!;
  let dominanceWinner = entries[0]!.botId;
  let bestShare = -Infinity;
  for (const [id, share] of Object.entries(finalGen.population)) {
    if (share > bestShare) {
      bestShare = share;
      dominanceWinner = id;
    }
  }

  return {
    mode: 'evolutionary',
    generations: generationsOut,
    generation1Winner,
    dominanceWinner,
    extinctEver: Array.from(extinctEver),
    seed,
    roundsPerMatch,
    noisyEnding,
    gameType,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Per-(generation, i, j) seed mixing. We mix `generation` into the
 * tournament seed first and then defer to `pairSeed` for the (i, j)
 * symmetric mixing — that way two evolutionary runs with the same
 * inputs reproduce match-by-match exactly.
 */
function generationPairSeed(seed: number, gen: number, i: number, j: number): number {
  let s = seed >>> 0;
  s = (s ^ Math.imul(gen + 1, 0x9e3779b9)) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x85ebca6b) >>> 0;
  return pairSeed(s, i, j);
}

function updateShares(
  shares: number[],
  fitness: number[],
  selection: 'replicator' | 'proportional',
  isAlive: (i: number) => boolean,
): number[] {
  const k = shares.length;
  const out = new Array<number>(k).fill(0);

  if (selection === 'proportional') {
    let totalFitness = 0;
    for (let i = 0; i < k; i++) {
      if (isAlive(i)) totalFitness += Math.max(0, fitness[i]!);
    }
    if (totalFitness <= 0) return shares.slice();
    for (let i = 0; i < k; i++) {
      out[i] = isAlive(i) ? Math.max(0, fitness[i]!) / totalFitness : 0;
    }
    return out;
  }

  // Replicator dynamics.
  let meanFitness = 0;
  for (let i = 0; i < k; i++) {
    if (isAlive(i)) meanFitness += shares[i]! * fitness[i]!;
  }
  if (meanFitness <= 0) return shares.slice();
  for (let i = 0; i < k; i++) {
    out[i] = isAlive(i) ? (shares[i]! * fitness[i]!) / meanFitness : 0;
  }
  return out;
}

/**
 * Build a per-generation leaderboard. Self-play matches are excluded
 * from totals so the leaderboard matches what an Axelrod-faithful
 * round-robin would have produced over the same set of strategies.
 */
function buildEvoLeaderboard(
  entries: EvolutionaryEntry[],
  score: number[][],
  isAlive: (i: number) => boolean,
): LeaderboardEntry[] {
  const k = entries.length;
  const rows: LeaderboardEntry[] = [];
  for (let i = 0; i < k; i++) {
    let total = 0;
    let matches = 0;
    if (isAlive(i)) {
      for (let j = 0; j < k; j++) {
        if (i === j) continue;
        if (!isAlive(j)) continue;
        total += score[i]![j]!;
        matches++;
      }
    }
    rows.push({
      instanceId: entries[i]!.botId,
      botId: entries[i]!.botId,
      totalScore: total,
      matchesPlayed: matches,
      averageScore: matches === 0 ? 0 : total / matches,
      rank: 0,
    });
  }
  rows.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore;
    return a.botId.localeCompare(b.botId);
  });
  let lastScore: number | null = null;
  let lastRank = 0;
  rows.forEach((row, idx) => {
    if (lastScore === null || row.totalScore !== lastScore) {
      row.rank = idx + 1;
      lastRank = idx + 1;
      lastScore = row.totalScore;
    } else {
      row.rank = lastRank;
    }
  });
  return rows;
}
