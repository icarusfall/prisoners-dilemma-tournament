// Round-robin tournament runner — the *authoritative* mode that decides
// the official winner of a club run.
//
// For every unordered pair of instances we play one `playMatch`, sum the
// scores into a leaderboard, and return the full match log so any single
// match can be replayed independently.
//
// Self-play is excluded by default (architecture §3.5, Axelrod-faithful).
// `includeSelfPlay: true` puts each instance against itself for
// experimental runs only — it does not feed the official leaderboard
// any differently, but it changes the average-score denominator.
//
// Determinism: each pairwise match is seeded by `pairSeed(tournamentSeed,
// i, j)` so a specific match can be replayed from `(tournamentSeed, i,
// j)` without re-running the whole tournament.

import type {
  BotInstance,
  LeaderboardEntry,
  MatchResult,
  TournamentResult,
} from './types.js';
import { playMatch } from './match.js';

export interface RunTournamentOptions {
  /** If true, each instance plays a match against itself. Default false. */
  includeSelfPlay?: boolean;
}

/**
 * Run a round-robin tournament. Pure given `(instances, rounds, seed,
 * options)`: same inputs always yield the same result.
 */
export function runTournament(
  instances: BotInstance[],
  roundsPerMatch: number,
  seed: number,
  options: RunTournamentOptions = {},
): TournamentResult {
  if (!Number.isInteger(roundsPerMatch) || roundsPerMatch <= 0) {
    throw new Error(
      `runTournament: roundsPerMatch must be a positive integer, got ${roundsPerMatch}`,
    );
  }
  if (instances.length < 2) {
    throw new Error(
      `runTournament: need at least 2 instances, got ${instances.length}`,
    );
  }
  // Reject duplicate instanceIds — every entry in the leaderboard must
  // be uniquely addressable.
  const seen = new Set<string>();
  for (const inst of instances) {
    if (seen.has(inst.instanceId)) {
      throw new Error(`runTournament: duplicate instanceId "${inst.instanceId}"`);
    }
    seen.add(inst.instanceId);
  }

  const includeSelfPlay = options.includeSelfPlay ?? false;
  const matches: MatchResult[] = [];

  // Per-instance running totals.
  const totals = new Map<string, { score: number; matches: number }>();
  for (const inst of instances) totals.set(inst.instanceId, { score: 0, matches: 0 });

  for (let i = 0; i < instances.length; i++) {
    const start = includeSelfPlay ? i : i + 1;
    for (let j = start; j < instances.length; j++) {
      const a = instances[i]!;
      const b = instances[j]!;
      const matchSeed = pairSeed(seed, i, j);
      const matchId = `m-${i}-${j}-${matchSeed}`;
      const result = playMatch(a, b, roundsPerMatch, matchSeed, { matchId });
      matches.push(result);

      const ta = totals.get(a.instanceId)!;
      const tb = totals.get(b.instanceId)!;
      if (i === j) {
        // Self-play: a single match contributes once, but both totals
        // refer to the same instance — count it as one match played.
        ta.score += result.totalA + result.totalB;
        ta.matches += 1;
      } else {
        ta.score += result.totalA;
        ta.matches += 1;
        tb.score += result.totalB;
        tb.matches += 1;
      }
    }
  }

  const leaderboard = buildLeaderboard(instances, totals);

  return {
    mode: 'round-robin',
    matches,
    leaderboard,
    seed,
    roundsPerMatch,
    includeSelfPlay,
  };
}

/**
 * Derive a deterministic per-match seed from `(tournamentSeed, i, j)`.
 *
 * The mixing is symmetric in (i, j) when sorted, so playing match
 * (i=2, j=5) reuses the same seed regardless of which loop order we
 * use. This is important for replays: a stored match record only needs
 * to remember `(tournamentSeed, i, j)` (or equivalently the matchId we
 * embed those into).
 */
export function pairSeed(tournamentSeed: number, i: number, j: number): number {
  const lo = Math.min(i, j);
  const hi = Math.max(i, j);
  // 32-bit mix: spread (lo, hi) into the seed bits with two big primes.
  let s = tournamentSeed >>> 0;
  s = (s ^ Math.imul(lo + 1, 0x27d4eb2d)) >>> 0;
  s = (s ^ Math.imul(hi + 1, 0x165667b1)) >>> 0;
  s = Math.imul(s ^ (s >>> 15), 0x85ebca6b) >>> 0;
  s = Math.imul(s ^ (s >>> 13), 0xc2b2ae35) >>> 0;
  return (s ^ (s >>> 16)) >>> 0;
}

function buildLeaderboard(
  instances: BotInstance[],
  totals: Map<string, { score: number; matches: number }>,
): LeaderboardEntry[] {
  const rows: LeaderboardEntry[] = instances.map((inst) => {
    const t = totals.get(inst.instanceId)!;
    return {
      instanceId: inst.instanceId,
      botId: inst.botId,
      totalScore: t.score,
      matchesPlayed: t.matches,
      averageScore: t.matches === 0 ? 0 : t.score / t.matches,
      rank: 0,
    };
  });

  // Sort by totalScore desc, breaking ties by averageScore then
  // instanceId so the order is deterministic.
  rows.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore;
    return a.instanceId.localeCompare(b.instanceId);
  });

  // Assign 1-indexed ranks; ties share a rank ("standard competition
  // ranking", 1-2-2-4 style).
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
