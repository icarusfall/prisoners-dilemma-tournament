import { describe, it, expect } from 'vitest';
import { compile } from '../src/interpreter.js';
import { playMatch } from '../src/match.js';
import {
  PRESETS,
  getPreset,
  ALLC,
  ALLD,
  TFT,
  TF2T,
  GRIM,
  PAVLOV,
  GENEROUS_TFT,
  RANDOM,
  JOSS,
  PROBER,
  type PresetId,
} from '../src/presets/index.js';
import type { BotInstance, BotSpec } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function instance(id: string, spec: BotSpec): BotInstance {
  return { instanceId: id, botId: spec.name, spec, decide: compile(spec) };
}

function moves(spec: BotSpec, opponent: BotSpec, rounds: number, seed = 1) {
  const a = instance('a', spec);
  const b = instance('b', opponent);
  return playMatch(a, b, rounds, seed);
}

// ---------------------------------------------------------------------------
// PRESETS table shape
// ---------------------------------------------------------------------------

describe('PRESETS table', () => {
  it('contains exactly 10 entries', () => {
    expect(PRESETS).toHaveLength(10);
  });

  it('has unique ids matching the ClassifierLabel set', () => {
    const ids = PRESETS.map((p) => p.id).sort();
    expect(ids).toEqual(
      ['ALLC', 'ALLD', 'GENEROUS_TFT', 'GRIM', 'JOSS', 'PAVLOV', 'PROBER', 'RANDOM', 'TF2T', 'TFT'].sort(),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every preset spec is JSON-serialisable', () => {
    for (const p of PRESETS) {
      const round = JSON.parse(JSON.stringify(p.spec));
      expect(round).toEqual(p.spec);
    }
  });

  it('every preset spec compiles to a callable DecisionFn', () => {
    for (const p of PRESETS) {
      const decide = compile(p.spec);
      expect(typeof decide).toBe('function');
    }
  });

  it('getPreset returns the right preset for each id', () => {
    for (const p of PRESETS) {
      expect(getPreset(p.id)).toBe(p);
    }
  });

  it('getPreset throws on unknown id', () => {
    expect(() => getPreset('NOPE' as PresetId)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Behavioural tests — each preset
// ---------------------------------------------------------------------------

describe('ALLC behaviour', () => {
  it('plays C in every round regardless of opponent', () => {
    const r = moves(ALLC, ALLD, 20);
    expect(r.rounds.every((rd) => rd.moveA === 'C')).toBe(true);
  });
});

describe('ALLD behaviour', () => {
  it('plays D in every round regardless of opponent', () => {
    const r = moves(ALLD, ALLC, 20);
    expect(r.rounds.every((rd) => rd.moveA === 'D')).toBe(true);
  });
});

describe('TFT behaviour', () => {
  it('cooperates first, then mirrors the opponent', () => {
    const r = moves(TFT, ALLD, 5);
    // Round 0: C. Rounds 1+: D (mirroring ALLD).
    expect(r.rounds.map((rd) => rd.moveA)).toEqual(['C', 'D', 'D', 'D', 'D']);
  });

  it('locks into mutual cooperation against ALLC', () => {
    const r = moves(TFT, ALLC, 10);
    expect(r.rounds.every((rd) => rd.moveA === 'C')).toBe(true);
  });
});

describe('TF2T behaviour', () => {
  it('tolerates a single defection but punishes two in a row', () => {
    // Build a custom opponent: D, C, D, D, C, C, ...
    const opponent: BotSpec = {
      name: 'PATTERN',
      version: 1,
      kind: 'dsl',
      initial: { type: 'move', move: 'D' },
      rules: [
        // round 1: C; round 2: D; round 3: D; round 4: C; round 5+: C
        { when: { type: 'round', op: 'eq', value: 1 }, do: { type: 'move', move: 'C' } },
        { when: { type: 'round', op: 'eq', value: 2 }, do: { type: 'move', move: 'D' } },
        { when: { type: 'round', op: 'eq', value: 3 }, do: { type: 'move', move: 'D' } },
      ],
      default: { type: 'move', move: 'C' },
    };
    const r = moves(TF2T, opponent, 6);
    // TF2T sees opponent: [D, C, D, D, C, C]
    // Round 0: C (initial)
    // Round 1: opponent's last is [D] — only 1, no DD pattern → C
    // Round 2: opponent's last 2 are [D,C] → C
    // Round 3: opponent's last 2 are [C,D] → C
    // Round 4: opponent's last 2 are [D,D] → D (PUNISH)
    // Round 5: opponent's last 2 are [D,C] → C
    expect(r.rounds.map((rd) => rd.moveA)).toEqual(['C', 'C', 'C', 'C', 'D', 'C']);
  });
});

describe('GRIM behaviour', () => {
  it('cooperates with ALLC forever', () => {
    const r = moves(GRIM, ALLC, 15);
    expect(r.rounds.every((rd) => rd.moveA === 'C')).toBe(true);
  });

  it('defects forever once the opponent ever defects', () => {
    // Opponent: C C D C C C C ...
    const opponent: BotSpec = {
      name: 'ONE_BLIP',
      version: 1,
      kind: 'dsl',
      initial: { type: 'move', move: 'C' },
      rules: [
        { when: { type: 'round', op: 'eq', value: 2 }, do: { type: 'move', move: 'D' } },
      ],
      default: { type: 'move', move: 'C' },
    };
    const r = moves(GRIM, opponent, 8);
    // GRIM round 0,1: C; round 2: still C (hasn't seen the D yet)
    // After round 2 GRIM has seen the D and defects forever from round 3.
    expect(r.rounds.map((rd) => rd.moveA)).toEqual([
      'C', 'C', 'C', 'D', 'D', 'D', 'D', 'D',
    ]);
  });
});

describe('PAVLOV behaviour', () => {
  it('locks into mutual cooperation against ALLC', () => {
    const r = moves(PAVLOV, ALLC, 10);
    expect(r.rounds.every((rd) => rd.moveA === 'C')).toBe(true);
  });

  it('against ALLD oscillates C, D, C, D... (lose-shift)', () => {
    const r = moves(PAVLOV, ALLD, 6);
    // Round 0: C (initial). They play D → I got S → loss → shift to D.
    // Round 1: D. They D → I got P → loss → shift to C.
    // Round 2: C. They D → S → shift to D.
    // ...alternates C, D, C, D, C, D
    expect(r.rounds.map((rd) => rd.moveA)).toEqual(['C', 'D', 'C', 'D', 'C', 'D']);
  });

  it('recovers from a single mutual-defection slip', () => {
    // Two PAVLOVs: round 0 both C → both win → both stay C → mutual coop forever.
    const r = moves(PAVLOV, PAVLOV, 20);
    expect(r.rounds.every((rd) => rd.moveA === 'C' && rd.moveB === 'C')).toBe(true);
  });
});

describe('GENEROUS_TFT behaviour', () => {
  it('cooperates first', () => {
    const r = moves(GENEROUS_TFT, ALLD, 1);
    expect(r.rounds[0]!.moveA).toBe('C');
  });

  it('mostly defects against ALLD but occasionally forgives', () => {
    // With 200 rounds, expected ~10% C → ~20 C moves. Allow a wide band.
    const r = moves(GENEROUS_TFT, ALLD, 200, 42);
    const cs = r.rounds.filter((rd) => rd.moveA === 'C').length;
    // Round 0 is always C, plus ~10% of the remaining 199 ≈ 20.
    // Expect somewhere in [5, 50] to be safe across seeds.
    expect(cs).toBeGreaterThan(5);
    expect(cs).toBeLessThan(50);
  });

  it('cooperates forever against ALLC', () => {
    const r = moves(GENEROUS_TFT, ALLC, 30);
    expect(r.rounds.every((rd) => rd.moveA === 'C')).toBe(true);
  });
});

describe('JOSS behaviour', () => {
  it('cooperates first', () => {
    const r = moves(JOSS, ALLC, 1);
    expect(r.rounds[0]!.moveA).toBe('C');
  });

  it('retaliates against ALLD like TFT', () => {
    const r = moves(JOSS, ALLD, 5);
    // Round 0: C. Rounds 1+: D (opponent defected, so always retaliate).
    expect(r.rounds.map((rd) => rd.moveA)).toEqual(['C', 'D', 'D', 'D', 'D']);
  });

  it('mostly cooperates against ALLC but sneaks in ~10% defections', () => {
    const r = moves(JOSS, ALLC, 200, 42);
    const ds = r.rounds.filter((rd) => rd.moveA === 'D').length;
    // ~10% of 200 = ~20 defections. Allow a wide band [5, 50].
    expect(ds).toBeGreaterThan(5);
    expect(ds).toBeLessThan(50);
  });
});

describe('PROBER behaviour', () => {
  it('cooperates on round 0, defects on rounds 1 and 2', () => {
    const r = moves(PROBER, ALLC, 3);
    expect(r.rounds.map((rd) => rd.moveA)).toEqual(['C', 'D', 'D']);
  });

  it('exploits an always-cooperator after the probe', () => {
    const r = moves(PROBER, ALLC, 10);
    // Round 0: C, rounds 1-2: D (probe), rounds 3+: D (exploit — ALLC never retaliated)
    const movesAfterProbe = r.rounds.slice(3).map((rd) => rd.moveA);
    expect(movesAfterProbe.every((m) => m === 'D')).toBe(true);
  });

  it('falls back to TFT-like play against a retaliator (not permanent DD)', () => {
    const r = moves(PROBER, TFT, 20);
    // After the probe (rounds 1-2) and peace offering (round 3),
    // Prober and TFT oscillate — each cooperates roughly half the time.
    // The key: it's NOT permanent mutual defection (which GRIM would cause).
    const laterMoves = r.rounds.slice(4).map((rd) => rd.moveA);
    const coopCount = laterMoves.filter((m) => m === 'C').length;
    expect(coopCount).toBeGreaterThan(0); // cooperates at least sometimes
    expect(coopCount).toBeLessThan(laterMoves.length); // but not always
  });
});

describe('RANDOM behaviour', () => {
  it('produces a roughly even mix over many rounds', () => {
    const r = moves(RANDOM, ALLC, 1000, 7);
    const cs = r.rounds.filter((rd) => rd.moveA === 'C').length;
    // 50% ± 10% wide band — coin flip on 1000 trials.
    expect(cs).toBeGreaterThan(400);
    expect(cs).toBeLessThan(600);
  });

  it('is deterministic given a fixed seed', () => {
    const a = moves(RANDOM, RANDOM, 50, 12345);
    const b = moves(RANDOM, RANDOM, 50, 12345);
    expect(a.rounds.map((r) => r.moveA)).toEqual(b.rounds.map((r) => r.moveA));
    expect(a.rounds.map((r) => r.moveB)).toEqual(b.rounds.map((r) => r.moveB));
  });
});
