import { describe, it, expect } from 'vitest';
import { compile } from '../src/interpreter.js';
import { runTournament } from '../src/tournament.js';
import { PAYOFFS } from '../src/scoring.js';
import type { BotInstance, BotSpec } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers — same minimal preset specs used by the match tests.
// ---------------------------------------------------------------------------

function instance(id: string, spec: BotSpec): BotInstance {
  return { instanceId: id, botId: spec.name, spec, decide: compile(spec) };
}

const ALLC: BotSpec = {
  name: 'ALLC',
  version: 1,
  kind: 'dsl',
  initial: { type: 'move', move: 'C' },
  rules: [],
  default: { type: 'move', move: 'C' },
};

const ALLD: BotSpec = {
  name: 'ALLD',
  version: 1,
  kind: 'dsl',
  initial: { type: 'move', move: 'D' },
  rules: [],
  default: { type: 'move', move: 'D' },
};

const TFT: BotSpec = {
  name: 'TFT',
  version: 1,
  kind: 'dsl',
  initial: { type: 'move', move: 'C' },
  rules: [
    {
      when: { type: 'opponentLastMove', equals: 'D' },
      do: { type: 'move', move: 'D' },
    },
  ],
  default: { type: 'move', move: 'C' },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runTournament — input validation', () => {
  it('rejects fewer than 2 instances', () => {
    expect(() => runTournament([], 5, 1)).toThrow();
    expect(() => runTournament([instance('a', ALLC)], 5, 1)).toThrow();
  });

  it('rejects non-positive roundsPerMatch', () => {
    expect(() =>
      runTournament([instance('a', ALLC), instance('b', ALLD)], 0, 1),
    ).toThrow();
    expect(() =>
      runTournament([instance('a', ALLC), instance('b', ALLD)], -3, 1),
    ).toThrow();
  });

  it('rejects duplicate instance ids', () => {
    expect(() =>
      runTournament([instance('a', ALLC), instance('a', ALLD)], 5, 1),
    ).toThrow();
  });
});

describe('runTournament — round-robin shape', () => {
  it('plays C(n,2) matches by default (no self-play)', () => {
    const instances = [
      instance('alld', ALLD),
      instance('allc', ALLC),
      instance('tft', TFT),
    ];
    const result = runTournament(instances, 10, 1);
    // 3 instances → 3 matches
    expect(result.matches).toHaveLength(3);
    expect(result.includeSelfPlay).toBe(false);
    expect(result.mode).toBe('round-robin');
    expect(result.seed).toBe(1);
    expect(result.roundsPerMatch).toBe(10);
  });

  it('plays C(n,2)+n matches with includeSelfPlay', () => {
    const instances = [
      instance('alld', ALLD),
      instance('allc', ALLC),
      instance('tft', TFT),
    ];
    const result = runTournament(instances, 10, 1, { includeSelfPlay: true });
    // 3 unordered pairs + 3 self-plays = 6
    expect(result.matches).toHaveLength(6);
    expect(result.includeSelfPlay).toBe(true);
  });

  it('every leaderboard entry references an actual instance', () => {
    const instances = [instance('a', ALLC), instance('b', ALLD), instance('c', TFT)];
    const result = runTournament(instances, 5, 1);
    const ids = new Set(instances.map((i) => i.instanceId));
    expect(result.leaderboard).toHaveLength(3);
    for (const row of result.leaderboard) {
      expect(ids.has(row.instanceId)).toBe(true);
      expect(row.matchesPlayed).toBe(2); // each plays the other two
      expect(row.averageScore).toBeCloseTo(row.totalScore / row.matchesPlayed);
    }
  });
});

describe('runTournament — Axelrod sanity checks', () => {
  it('TFT beats ALLD when there are enough TFTs to sustain cooperation', () => {
    // The classical Axelrod insight: TFT loses head-to-head against ALLD
    // by exactly one sucker payoff per match, but it gains a full mutual-
    // cooperation streak with every other TFT. With two TFTs and one
    // ALLD, the cooperation surplus dominates.
    const instances = [
      instance('tft1', TFT),
      instance('tft2', TFT),
      instance('alld', ALLD),
    ];
    const result = runTournament(instances, 200, 1);
    const tft1 = result.leaderboard.find((r) => r.instanceId === 'tft1')!;
    const tft2 = result.leaderboard.find((r) => r.instanceId === 'tft2')!;
    const alld = result.leaderboard.find((r) => r.instanceId === 'alld')!;
    expect(tft1.totalScore).toBeGreaterThan(alld.totalScore);
    expect(tft2.totalScore).toBeGreaterThan(alld.totalScore);
  });

  it('a pool of pure cooperators is a Pareto-optimum', () => {
    const instances = [
      instance('c1', ALLC),
      instance('c2', ALLC),
      instance('c3', ALLC),
      instance('c4', ALLC),
    ];
    const rounds = 20;
    const result = runTournament(instances, rounds, 1);
    // Each instance plays the other 3, all mutual coop.
    for (const row of result.leaderboard) {
      expect(row.totalScore).toBe(3 * rounds * PAYOFFS.R);
      expect(row.matchesPlayed).toBe(3);
    }
  });

  it('leaderboard is sorted descending and ranks are dense for ties', () => {
    const instances = [
      instance('c1', ALLC),
      instance('c2', ALLC),
      instance('alld', ALLD),
    ];
    const result = runTournament(instances, 10, 1);
    // The two cooperators tie; ALLD beats them both head-on.
    // Sorted desc: ALLD first, then the two ALLCs sharing rank 2.
    const ranks = result.leaderboard.map((r) => r.rank);
    expect(ranks[0]).toBe(1);
    expect(ranks[1]).toBe(2);
    expect(ranks[2]).toBe(2);
    // Sort order is total-score descending.
    for (let i = 1; i < result.leaderboard.length; i++) {
      expect(result.leaderboard[i - 1]!.totalScore).toBeGreaterThanOrEqual(
        result.leaderboard[i]!.totalScore,
      );
    }
  });
});

describe('runTournament — determinism', () => {
  it('same inputs → byte-identical leaderboards and match results', () => {
    const make = () => [
      instance('tft', TFT),
      instance('alld', ALLD),
      instance('allc', ALLC),
    ];
    const r1 = runTournament(make(), 50, 4242);
    const r2 = runTournament(make(), 50, 4242);
    expect(r1.leaderboard).toEqual(r2.leaderboard);
    expect(r1.matches).toEqual(r2.matches);
  });
});
