import { describe, it, expect } from 'vitest';
import { runEvolutionaryTournament } from '../src/evolutionary.js';
import type { BotSpec } from '../src/types.js';

// ---------------------------------------------------------------------------
// Minimal preset specs (same as the other engine tests).
// ---------------------------------------------------------------------------

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
// Validation
// ---------------------------------------------------------------------------

describe('runEvolutionaryTournament — input validation', () => {
  const baseEntries = [
    { botId: 'tft', spec: TFT, initialShare: 1 },
    { botId: 'alld', spec: ALLD, initialShare: 1 },
  ];

  it('rejects fewer than 2 entries', () => {
    expect(() => runEvolutionaryTournament([], 10, 5, 1)).toThrow();
    expect(() =>
      runEvolutionaryTournament([{ botId: 'tft', spec: TFT, initialShare: 1 }], 10, 5, 1),
    ).toThrow();
  });

  it('rejects non-positive roundsPerMatch', () => {
    expect(() => runEvolutionaryTournament(baseEntries, 0, 5, 1)).toThrow();
    expect(() => runEvolutionaryTournament(baseEntries, -1, 5, 1)).toThrow();
  });

  it('rejects non-positive generations', () => {
    expect(() => runEvolutionaryTournament(baseEntries, 10, 0, 1)).toThrow();
    expect(() => runEvolutionaryTournament(baseEntries, 10, -1, 1)).toThrow();
  });

  it('rejects duplicate botIds', () => {
    expect(() =>
      runEvolutionaryTournament(
        [
          { botId: 'tft', spec: TFT, initialShare: 1 },
          { botId: 'tft', spec: ALLD, initialShare: 1 },
        ],
        10,
        5,
        1,
      ),
    ).toThrow();
  });

  it('rejects negative initial shares', () => {
    expect(() =>
      runEvolutionaryTournament(
        [
          { botId: 'tft', spec: TFT, initialShare: -1 },
          { botId: 'alld', spec: ALLD, initialShare: 1 },
        ],
        10,
        5,
        1,
      ),
    ).toThrow();
  });

  it('rejects an all-zero initial population', () => {
    expect(() =>
      runEvolutionaryTournament(
        [
          { botId: 'tft', spec: TFT, initialShare: 0 },
          { botId: 'alld', spec: ALLD, initialShare: 0 },
        ],
        10,
        5,
        1,
      ),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

describe('runEvolutionaryTournament — result shape', () => {
  it('records one Generation per requested generation', () => {
    const result = runEvolutionaryTournament(
      [
        { botId: 'tft', spec: TFT, initialShare: 1 },
        { botId: 'alld', spec: ALLD, initialShare: 1 },
      ],
      20,
      7,
      1,
    );
    expect(result.mode).toBe('evolutionary');
    expect(result.generations).toHaveLength(7);
    expect(result.generations[0]?.index).toBe(0);
    expect(result.generations[6]?.index).toBe(6);
    expect(result.seed).toBe(1);
    expect(result.roundsPerMatch).toBe(20);
  });

  it('preserves the initial total weight by default', () => {
    const result = runEvolutionaryTournament(
      [
        { botId: 'tft', spec: TFT, initialShare: 10 },
        { botId: 'alld', spec: ALLD, initialShare: 10 },
      ],
      20,
      3,
      1,
    );
    for (const gen of result.generations) {
      const total = Object.values(gen.population).reduce((s, x) => s + x, 0);
      expect(total).toBeCloseTo(20);
    }
  });

  it('reports normalised shares when preserveTotal: false', () => {
    const result = runEvolutionaryTournament(
      [
        { botId: 'tft', spec: TFT, initialShare: 10 },
        { botId: 'alld', spec: ALLD, initialShare: 10 },
      ],
      20,
      3,
      1,
      { preserveTotal: false },
    );
    for (const gen of result.generations) {
      const total = Object.values(gen.population).reduce((s, x) => s + x, 0);
      expect(total).toBeCloseTo(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Behavioural sanity checks
// ---------------------------------------------------------------------------

describe('runEvolutionaryTournament — behavioural sanity', () => {
  it('a pure-ALLC + ALLD pool drives ALLC to extinction', () => {
    const result = runEvolutionaryTournament(
      [
        { botId: 'allc', spec: ALLC, initialShare: 1 },
        { botId: 'alld', spec: ALLD, initialShare: 1 },
      ],
      50,
      40,
      1,
    );
    const final = result.generations[result.generations.length - 1]!;
    expect(final.population['allc']).toBe(0);
    expect(final.population['alld']).toBeGreaterThan(0);
    expect(result.dominanceWinner).toBe('alld');
    expect(result.extinctEver).toContain('allc');
  });

  it('classic Axelrod-Hamilton inversion: gen-1 winner ≠ dominance winner in {TFT, ALLD, ALLC}', () => {
    // Headline test for the entire evolutionary mode. With a fresh
    // pool of equal TFT, ALLD, ALLC, ALLD wins generation 1 by raw
    // points (it exploits ALLC mercilessly). But TFT, which sustains
    // mutual cooperation with itself, accumulates a fitness edge as
    // shares shift and eventually dominates the population. This
    // gen-1-winner ≠ long-run-winner inversion is the entire point of
    // running an evolutionary tournament alongside a one-shot one.
    const result = runEvolutionaryTournament(
      [
        { botId: 'tft', spec: TFT, initialShare: 1 },
        { botId: 'alld', spec: ALLD, initialShare: 1 },
        { botId: 'allc', spec: ALLC, initialShare: 1 },
      ],
      200,
      80,
      1,
    );
    expect(result.generation1Winner).toBe('alld');
    expect(result.dominanceWinner).toBe('tft');
    // At least one strategy goes extinct along the way — the dynamics
    // are non-trivial enough that one of {ALLD, ALLC} dies. Which one
    // depends on the threshold and rounds-per-match (with rounds=200
    // and threshold=0.01, ALLD actually dies first because TFT
    // dominates so completely; ALLC then sits at neutral fitness with
    // TFT in a TFT-dominated world).
    expect(result.extinctEver.length).toBeGreaterThan(0);
  });

  it('a pure-cooperator pool stays stable forever', () => {
    const result = runEvolutionaryTournament(
      [
        { botId: 'allc1', spec: ALLC, initialShare: 1 },
        { botId: 'allc2', spec: ALLC, initialShare: 1 },
        { botId: 'allc3', spec: ALLC, initialShare: 1 },
      ],
      20,
      10,
      1,
    );
    const initial = result.generations[0]!.population;
    const final = result.generations[result.generations.length - 1]!.population;
    // Three identical strategies starting with equal shares stay
    // exactly equal — fitness is identical for all so replicator is
    // the identity map.
    expect(final['allc1']).toBeCloseTo(initial['allc1']!);
    expect(final['allc2']).toBeCloseTo(initial['allc2']!);
    expect(final['allc3']).toBeCloseTo(initial['allc3']!);
    expect(result.extinctEver).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('runEvolutionaryTournament — determinism', () => {
  it('same inputs → identical generations array', () => {
    const make = () => [
      { botId: 'tft', spec: TFT, initialShare: 1 },
      { botId: 'alld', spec: ALLD, initialShare: 1 },
      { botId: 'allc', spec: ALLC, initialShare: 1 },
    ];
    const a = runEvolutionaryTournament(make(), 100, 20, 4242);
    const b = runEvolutionaryTournament(make(), 100, 20, 4242);
    expect(a.generations).toEqual(b.generations);
    expect(a.dominanceWinner).toBe(b.dominanceWinner);
    expect(a.generation1Winner).toBe(b.generation1Winner);
    expect(a.extinctEver).toEqual(b.extinctEver);
  });
});

// ---------------------------------------------------------------------------
// Selection rules
// ---------------------------------------------------------------------------

describe('runEvolutionaryTournament — selection rules', () => {
  it('proportional selection settles to a non-trivial fixed point in {ALLC, ALLD}', () => {
    // Proportional selection has a fixed point where ALLC survives
    // *because* ALLD's fitness depends on having ALLC prey to exploit
    // — fewer ALLC means fewer T-payoffs for ALLD, which slows ALLD's
    // growth. With these scores the equilibrium ALLC share is 2/7,
    // well above the 0.01 extinction threshold. This is genuinely
    // different from replicator dynamics, where ALLC would die.
    const result = runEvolutionaryTournament(
      [
        { botId: 'allc', spec: ALLC, initialShare: 1 },
        { botId: 'alld', spec: ALLD, initialShare: 1 },
      ],
      50,
      40,
      1,
      { selection: 'proportional' },
    );
    const final = result.generations[result.generations.length - 1]!;
    expect(result.dominanceWinner).toBe('alld');
    expect(final.population['alld']).toBeGreaterThan(final.population['allc']!);
    expect(final.population['allc']).toBeGreaterThan(0);
    // Should be approaching the analytical fixed point of 2/7 ≈ 0.286
    // in normalised share, which is 2 × 2/7 ≈ 0.571 with the default
    // preserveTotal: true and an initial total of 2.
    expect(final.population['allc']).toBeCloseTo((2 / 7) * 2, 2);
  });
});
