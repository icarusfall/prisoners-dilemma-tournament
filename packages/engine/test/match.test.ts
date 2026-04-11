import { describe, it, expect } from 'vitest';
import { compile } from '../src/interpreter.js';
import { playMatch } from '../src/match.js';
import { mulberry32, deriveInstanceSeed } from '../src/rng.js';
import { PAYOFFS } from '../src/scoring.js';
import type { BotInstance, BotSpec } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers — wrap a BotSpec in a BotInstance with a stable instanceId.
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

const COIN_FLIPPER: BotSpec = {
  name: 'COIN',
  version: 1,
  kind: 'dsl',
  initial: { type: 'random', weights: { C: 1, D: 1 } },
  rules: [],
  default: { type: 'random', weights: { C: 1, D: 1 } },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('rng — mulberry32', () => {
  it('produces the same sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let differences = 0;
    for (let i = 0; i < 50; i++) {
      if (a() !== b()) differences++;
    }
    expect(differences).toBeGreaterThan(40);
  });

  it('returns values in [0, 1)', () => {
    const r = mulberry32(123);
    for (let i = 0; i < 500; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('rng — deriveInstanceSeed', () => {
  it('is deterministic', () => {
    expect(deriveInstanceSeed(7, 0)).toBe(deriveInstanceSeed(7, 0));
    expect(deriveInstanceSeed(7, 1)).toBe(deriveInstanceSeed(7, 1));
  });

  it('separates instance 0 from instance 1', () => {
    expect(deriveInstanceSeed(7, 0)).not.toBe(deriveInstanceSeed(7, 1));
  });

  it('separates seed 1 from seed 2', () => {
    expect(deriveInstanceSeed(1, 0)).not.toBe(deriveInstanceSeed(2, 0));
  });
});

describe('playMatch — deterministic head-to-head', () => {
  it('rejects non-positive round counts', () => {
    expect(() => playMatch(instance('a', ALLC), instance('b', ALLD), 0, 1)).toThrow();
    expect(() => playMatch(instance('a', ALLC), instance('b', ALLD), -3, 1)).toThrow();
    expect(() => playMatch(instance('a', ALLC), instance('b', ALLD), 1.5, 1)).toThrow();
  });

  it('ALLC vs ALLD: cooperator gets sucker every round', () => {
    const result = playMatch(instance('c', ALLC), instance('d', ALLD), 10, 1);
    expect(result.rounds).toHaveLength(10);
    for (const r of result.rounds) {
      expect(r.moveA).toBe('C');
      expect(r.moveB).toBe('D');
      expect(r.scoreA).toBe(PAYOFFS.S);
      expect(r.scoreB).toBe(PAYOFFS.T);
    }
    expect(result.totalA).toBe(10 * PAYOFFS.S);
    expect(result.totalB).toBe(10 * PAYOFFS.T);
  });

  it('ALLC vs ALLC: mutual cooperation pays R every round', () => {
    const result = playMatch(instance('c1', ALLC), instance('c2', ALLC), 5, 1);
    expect(result.totalA).toBe(5 * PAYOFFS.R);
    expect(result.totalB).toBe(5 * PAYOFFS.R);
  });

  it('ALLD vs ALLD: mutual defection pays P every round', () => {
    const result = playMatch(instance('d1', ALLD), instance('d2', ALLD), 5, 1);
    expect(result.totalA).toBe(5 * PAYOFFS.P);
    expect(result.totalB).toBe(5 * PAYOFFS.P);
  });

  it('TFT vs ALLD: cooperates round 0, then defects forever', () => {
    const result = playMatch(instance('tft', TFT), instance('alld', ALLD), 5, 1);
    expect(result.rounds[0]?.moveA).toBe('C');
    expect(result.rounds[0]?.moveB).toBe('D');
    for (let i = 1; i < 5; i++) {
      expect(result.rounds[i]?.moveA).toBe('D');
      expect(result.rounds[i]?.moveB).toBe('D');
    }
    // TFT scores: S + 4*P; ALLD scores: T + 4*P
    expect(result.totalA).toBe(PAYOFFS.S + 4 * PAYOFFS.P);
    expect(result.totalB).toBe(PAYOFFS.T + 4 * PAYOFFS.P);
  });

  it('TFT vs TFT: locks into mutual cooperation forever', () => {
    const result = playMatch(instance('a', TFT), instance('b', TFT), 20, 1);
    expect(result.totalA).toBe(20 * PAYOFFS.R);
    expect(result.totalB).toBe(20 * PAYOFFS.R);
  });
});

describe('playMatch — determinism and isolation', () => {
  it('same seed → identical match result for stochastic bots', () => {
    const r1 = playMatch(
      instance('x', COIN_FLIPPER),
      instance('y', COIN_FLIPPER),
      50,
      12345,
    );
    const r2 = playMatch(
      instance('x', COIN_FLIPPER),
      instance('y', COIN_FLIPPER),
      50,
      12345,
    );
    expect(r1.rounds).toEqual(r2.rounds);
    expect(r1.totalA).toBe(r2.totalA);
    expect(r1.totalB).toBe(r2.totalB);
  });

  it('different seeds usually diverge for stochastic bots', () => {
    const r1 = playMatch(
      instance('x', COIN_FLIPPER),
      instance('y', COIN_FLIPPER),
      50,
      1,
    );
    const r2 = playMatch(
      instance('x', COIN_FLIPPER),
      instance('y', COIN_FLIPPER),
      50,
      2,
    );
    // Allow equal totals by chance, but the sequences should differ.
    expect(r1.rounds).not.toEqual(r2.rounds);
  });

  it("instance B's RNG cannot affect instance A's draws", () => {
    // A is a coin flipper; B is deterministic. Replacing B with a
    // different deterministic bot must NOT change A's move sequence,
    // because A's RNG is derived purely from (seed, instanceIndex=0).
    const aMovesVsAllc = playMatch(
      instance('a', COIN_FLIPPER),
      instance('b', ALLC),
      30,
      999,
    ).rounds.map((r) => r.moveA);
    const aMovesVsAlld = playMatch(
      instance('a', COIN_FLIPPER),
      instance('b', ALLD),
      30,
      999,
    ).rounds.map((r) => r.moveA);
    expect(aMovesVsAllc).toEqual(aMovesVsAlld);
  });

  it('records the seed and instance ids on the result', () => {
    const result = playMatch(instance('alpha', TFT), instance('beta', ALLD), 3, 77);
    expect(result.seed).toBe(77);
    expect(result.instanceA).toBe('alpha');
    expect(result.instanceB).toBe('beta');
    expect(result.matchId).toContain('alpha');
    expect(result.matchId).toContain('beta');
    expect(result.matchId).toContain('77');
  });
});
