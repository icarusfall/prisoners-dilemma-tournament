import { describe, it, expect } from 'vitest';
import { compile } from '../src/interpreter.js';
import type { BotSpec, BotView, CodeBotSpec, Move } from '../src/types.js';
import { CODE_MAX_LENGTH } from '../src/interpreter.js';

// ---------------------------------------------------------------------------
// Helpers for building synthetic BotViews. The interpreter is pure given
// a view, so we never need to spin up a full match runner here.
// ---------------------------------------------------------------------------

function fixedRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length] ?? 0.5;
    i++;
    return v;
  };
}

function view(
  myMoves: Move[],
  theirMoves: Move[],
  rng: () => number = () => 0.5,
): BotView {
  return {
    selfInstanceId: 'self',
    opponentInstanceId: 'opp',
    round: myMoves.length,
    history: { myMoves, theirMoves },
    rng,
  };
}

// ---------------------------------------------------------------------------
// Canonical preset specs — same shape that will live in src/presets/
// in task 8. Inlining a few here so the interpreter test is self-contained
// and we can verify the DSL is expressive enough for every classical
// strategy before committing the JSON files.
// ---------------------------------------------------------------------------

const TFT: BotSpec = {
  name: 'TFT',
  version: 1,
  kind: 'dsl',
  initial: { type: 'move', move: 'C' },
  rules: [
    {
      comment: 'mirror opponent on every subsequent round',
      when: { type: 'opponentLastMove', equals: 'D' },
      do: { type: 'move', move: 'D' },
    },
  ],
  default: { type: 'move', move: 'C' },
};

const GRIM: BotSpec = {
  name: 'GRIM',
  version: 1,
  kind: 'dsl',
  initial: { type: 'move', move: 'C' },
  rules: [
    {
      comment: 'once opponent has ever defected, defect forever',
      when: { type: 'opponentDefectionRate', op: 'gt', value: 0 },
      do: { type: 'move', move: 'D' },
    },
  ],
  default: { type: 'move', move: 'C' },
};

const TF2T: BotSpec = {
  name: 'TF2T',
  version: 1,
  kind: 'dsl',
  initial: { type: 'move', move: 'C' },
  rules: [
    {
      comment: 'defect only after two consecutive opponent defections',
      when: {
        type: 'patternInLastN',
        side: 'opponent',
        n: 2,
        pattern: ['D', 'D'],
      },
      do: { type: 'move', move: 'D' },
    },
  ],
  default: { type: 'move', move: 'C' },
};

const PAVLOV: BotSpec = {
  name: 'PAVLOV',
  version: 1,
  kind: 'dsl',
  initial: { type: 'move', move: 'C' },
  rules: [
    {
      comment: 'win-stay, lose-shift: cooperate iff our last moves matched',
      when: {
        type: 'or',
        of: [
          {
            type: 'and',
            of: [
              { type: 'myLastMove', equals: 'C' },
              { type: 'opponentLastMove', equals: 'C' },
            ],
          },
          {
            type: 'and',
            of: [
              { type: 'myLastMove', equals: 'D' },
              { type: 'opponentLastMove', equals: 'D' },
            ],
          },
        ],
      },
      do: { type: 'move', move: 'C' },
    },
  ],
  default: { type: 'move', move: 'D' },
};

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('interpreter — round 0 / fall-through', () => {
  it('plays the initial action on round 0 regardless of rules', () => {
    const decide = compile(TFT);
    expect(decide(view([], []))).toBe('C');
    expect(decide(view([], []))).toBe('C');
  });

  it('falls through to default when no rule matches', () => {
    const decide = compile({
      ...ALLC,
      rules: [
        {
          when: { type: 'opponentLastMove', equals: 'D' },
          do: { type: 'move', move: 'D' },
        },
      ],
    });
    expect(decide(view(['C'], ['C']))).toBe('C');
  });
});

describe('interpreter — classical presets behave correctly', () => {
  it('ALLC always cooperates', () => {
    const decide = compile(ALLC);
    expect(decide(view([], []))).toBe('C');
    expect(decide(view(['C', 'C'], ['D', 'D']))).toBe('C');
  });

  it('ALLD always defects', () => {
    const decide = compile(ALLD);
    expect(decide(view([], []))).toBe('D');
    expect(decide(view(['D', 'D'], ['C', 'C']))).toBe('D');
  });

  it('TFT cooperates first, then mirrors', () => {
    const decide = compile(TFT);
    expect(decide(view([], []))).toBe('C');
    expect(decide(view(['C'], ['C']))).toBe('C');
    expect(decide(view(['C'], ['D']))).toBe('D');
    expect(decide(view(['C', 'D'], ['D', 'C']))).toBe('C');
  });

  it('GRIM cooperates until any defection, then defects forever', () => {
    const decide = compile(GRIM);
    expect(decide(view([], []))).toBe('C');
    expect(decide(view(['C', 'C'], ['C', 'C']))).toBe('C');
    expect(decide(view(['C', 'C', 'C'], ['C', 'D', 'C']))).toBe('D');
    // Even after the opponent goes back to C forever, GRIM stays D.
    expect(decide(view(['C', 'D', 'D', 'D'], ['C', 'D', 'C', 'C']))).toBe('D');
  });

  it('TF2T tolerates one defection, defects after two in a row', () => {
    const decide = compile(TF2T);
    expect(decide(view(['C'], ['D']))).toBe('C');
    expect(decide(view(['C', 'C'], ['D', 'C']))).toBe('C');
    expect(decide(view(['C', 'C'], ['D', 'D']))).toBe('D');
    expect(decide(view(['C', 'C', 'D'], ['D', 'D', 'C']))).toBe('C');
  });

  it('PAVLOV stays after a win, switches after a loss', () => {
    const decide = compile(PAVLOV);
    // CC last round (mutual cooperation, both win) → cooperate again
    expect(decide(view(['C'], ['C']))).toBe('C');
    // DD last round (mutual defection, technically both "lose" relative
    // to mutual coop, but symmetric — Pavlov rule: if my move == their
    // move, stay. Both played D, so we should "stay" → C? No: classic
    // Pavlov is win-stay/lose-shift on outcome, where DD is a loss.
    // Our PAVLOV spec encodes "cooperate iff last moves matched" which
    // means CC→C and DD→C (both matched). This is the standard Pavlov
    // formulation.
    expect(decide(view(['D'], ['D']))).toBe('C');
    // CD last round (sucker) → switch → D
    expect(decide(view(['C'], ['D']))).toBe('D');
    // DC last round (temptation) → switch → D
    expect(decide(view(['D'], ['C']))).toBe('D');
  });
});

describe('interpreter — Bayesian-lite primitives', () => {
  it('opponentDefectionRate respects an optional window', () => {
    const spec: BotSpec = {
      name: 'window-tester',
      version: 1,
      kind: 'dsl',
      initial: { type: 'move', move: 'C' },
      rules: [
        {
          when: {
            type: 'opponentDefectionRate',
            op: 'gte',
            value: 0.5,
            window: 3,
          },
          do: { type: 'move', move: 'D' },
        },
      ],
      default: { type: 'move', move: 'C' },
    };
    const decide = compile(spec);
    // Last 3 of opponent ['D','D','D','C','D'] are ['D','C','D'] →
    // defection rate 2/3 ≥ 0.5 → defect.
    expect(
      decide(view(['C', 'C', 'C', 'C', 'C'], ['D', 'D', 'D', 'C', 'D'])),
    ).toBe('D');
    // Last 3 of ['C','C','D','C','C'] are ['D','C','C'] → 1/3 < 0.5 → coop.
    expect(
      decide(view(['C', 'C', 'C', 'C', 'C'], ['C', 'C', 'D', 'C', 'C'])),
    ).toBe('C');
  });

  it('transitionProb computes P(next | previous) over history', () => {
    const spec: BotSpec = {
      name: 'transition-tester',
      version: 1,
      kind: 'dsl',
      initial: { type: 'move', move: 'C' },
      rules: [
        {
          when: {
            type: 'transitionProb',
            from: 'D',
            to: 'C',
            op: 'gte',
            value: 0.99,
          },
          do: { type: 'move', move: 'D' },
        },
      ],
      default: { type: 'move', move: 'C' },
    };
    const decide = compile(spec);
    // Opponent history C,D,C,D,C — every D is followed by a C → P(C|D)=1
    expect(decide(view(['C', 'C', 'C', 'C', 'C'], ['C', 'D', 'C', 'D', 'C']))).toBe('D');
    // Opponent history D,D,D,D,D — every D is followed by D → P(C|D)=0
    expect(decide(view(['C', 'C', 'C', 'C', 'C'], ['D', 'D', 'D', 'D', 'D']))).toBe('C');
  });

  it('classifyOpponent returns ALLD against constant defection', () => {
    const spec: BotSpec = {
      name: 'classify-tester',
      version: 1,
      kind: 'dsl',
      initial: { type: 'move', move: 'C' },
      rules: [
        {
          when: { type: 'classifyOpponent', equals: 'ALLD' },
          do: { type: 'move', move: 'D' },
        },
      ],
      default: { type: 'move', move: 'C' },
    };
    const decide = compile(spec);
    expect(decide(view(['C', 'C', 'C', 'C', 'C'], ['D', 'D', 'D', 'D', 'D']))).toBe('D');
  });

  it('classifyOpponent returns ALLC against constant cooperation', () => {
    const spec: BotSpec = {
      name: 'classify-tester',
      version: 1,
      kind: 'dsl',
      initial: { type: 'move', move: 'C' },
      rules: [
        {
          when: { type: 'classifyOpponent', equals: 'ALLC' },
          do: { type: 'move', move: 'D' },
        },
      ],
      default: { type: 'move', move: 'C' },
    };
    const decide = compile(spec);
    // Six rounds of constant cooperation → ALLC
    expect(decide(view(['C', 'C', 'C', 'C', 'C', 'C'], ['C', 'C', 'C', 'C', 'C', 'C']))).toBe(
      'D',
    );
  });

  it('classifyOpponent returns TFT when opponent perfectly mirrors my last move', () => {
    const spec: BotSpec = {
      name: 'classify-tester',
      version: 1,
      kind: 'dsl',
      initial: { type: 'move', move: 'C' },
      rules: [
        {
          when: { type: 'classifyOpponent', equals: 'TFT' },
          do: { type: 'move', move: 'D' },
        },
      ],
      default: { type: 'move', move: 'C' },
    };
    const decide = compile(spec);
    // I play C,D,C,D,C; opponent (TFT) plays C,C,D,C,D → mirror of my prev
    expect(decide(view(['C', 'D', 'C', 'D', 'C'], ['C', 'C', 'D', 'C', 'D']))).toBe('D');
  });

  it('classifyOpponent returns UNKNOWN with too few rounds', () => {
    const spec: BotSpec = {
      name: 'classify-tester',
      version: 1,
      kind: 'dsl',
      initial: { type: 'move', move: 'C' },
      rules: [
        {
          when: { type: 'classifyOpponent', equals: 'UNKNOWN' },
          do: { type: 'move', move: 'D' },
        },
      ],
      default: { type: 'move', move: 'C' },
    };
    const decide = compile(spec);
    expect(decide(view(['C', 'C'], ['D', 'D']))).toBe('D');
  });
});

describe('interpreter — combinators and stochastic actions', () => {
  it('and/or/not compose correctly', () => {
    const spec: BotSpec = {
      name: 'combinator-tester',
      version: 1,
      kind: 'dsl',
      initial: { type: 'move', move: 'C' },
      rules: [
        {
          when: {
            type: 'and',
            of: [
              { type: 'opponentLastMove', equals: 'D' },
              { type: 'not', of: { type: 'myLastMove', equals: 'D' } },
            ],
          },
          do: { type: 'move', move: 'D' },
        },
      ],
      default: { type: 'move', move: 'C' },
    };
    const decide = compile(spec);
    // opponent D, me C → matches → D
    expect(decide(view(['C'], ['D']))).toBe('D');
    // opponent D, me D → not(myLastMove=D) is false → C
    expect(decide(view(['D'], ['D']))).toBe('C');
    // opponent C → first clause false → C
    expect(decide(view(['C'], ['C']))).toBe('C');
  });

  it('stochastic actions respect weights via the seeded RNG', () => {
    const spec: BotSpec = {
      name: 'stochastic',
      version: 1,
      kind: 'dsl',
      initial: { type: 'random', weights: { C: 0.7, D: 0.3 } },
      rules: [],
      default: { type: 'random', weights: { C: 0.7, D: 0.3 } },
    };
    const decide = compile(spec);
    // RNG returns 0.5 → 0.5 * 1.0 = 0.5 < 0.7 → C
    expect(decide({ ...view([], []), rng: () => 0.5 })).toBe('C');
    // RNG returns 0.9 → 0.9 < 0.7 false → D
    expect(decide({ ...view([], []), rng: () => 0.9 })).toBe('D');
    // RNG returns 0.0 → guaranteed C
    expect(decide({ ...view([], []), rng: () => 0.0 })).toBe('C');
  });

  it('random predicate uses the same RNG stream', () => {
    const spec: BotSpec = {
      name: 'random-pred',
      version: 1,
      kind: 'dsl',
      initial: { type: 'move', move: 'C' },
      rules: [
        {
          when: { type: 'random', op: 'lt', value: 0.1 },
          do: { type: 'move', move: 'D' },
        },
      ],
      default: { type: 'move', move: 'C' },
    };
    const decide = compile(spec);
    // RNG draws 0.05 → < 0.1 → D
    expect(decide(view(['C'], ['C'], fixedRng([0.05])))).toBe('D');
    // RNG draws 0.5 → not < 0.1 → C
    expect(decide(view(['C'], ['C'], fixedRng([0.5])))).toBe('C');
  });
});

// ---------------------------------------------------------------------------
// Code-tier bots
// ---------------------------------------------------------------------------

describe('compile — code-tier bots', () => {
  it('compiles a basic TFT as code', () => {
    const spec: CodeBotSpec = {
      name: 'CodeTFT',
      version: 1,
      kind: 'code',
      code: `if (view.round === 0) return 'C';
return view.history.theirMoves[view.round - 1];`,
    };
    const decide = compile(spec);
    expect(decide(view([], []))).toBe('C');
    expect(decide(view(['C'], ['C']))).toBe('C');
    expect(decide(view(['C', 'C'], ['C', 'D']))).toBe('D');
    expect(decide(view(['C', 'C', 'D'], ['C', 'D', 'C']))).toBe('C');
  });

  it('compiles an always-defect code bot', () => {
    const spec: CodeBotSpec = {
      name: 'CodeALLD',
      version: 1,
      kind: 'code',
      code: `return 'D';`,
    };
    const decide = compile(spec);
    expect(decide(view([], []))).toBe('D');
    expect(decide(view(['D'], ['C']))).toBe('D');
  });

  it('can use view.rng() for stochastic strategies', () => {
    const spec: CodeBotSpec = {
      name: 'CodeRandom',
      version: 1,
      kind: 'code',
      code: `return view.rng() < 0.5 ? 'C' : 'D';`,
    };
    const decide = compile(spec);
    // rng returns 0.3 → C
    expect(decide(view([], [], fixedRng([0.3])))).toBe('C');
    // rng returns 0.7 → D
    expect(decide(view([], [], fixedRng([0.7])))).toBe('D');
  });

  it('defaults to C on runtime error', () => {
    const spec: CodeBotSpec = {
      name: 'Crasher',
      version: 1,
      kind: 'code',
      code: `throw new Error('oops');`,
    };
    const decide = compile(spec);
    expect(decide(view([], []))).toBe('C');
  });

  it('defaults to C on invalid return value', () => {
    const spec: CodeBotSpec = {
      name: 'BadReturn',
      version: 1,
      kind: 'code',
      code: `return 42;`,
    };
    const decide = compile(spec);
    expect(decide(view([], []))).toBe('C');
  });

  it('defaults to C when returning undefined', () => {
    const spec: CodeBotSpec = {
      name: 'NoReturn',
      version: 1,
      kind: 'code',
      code: `// no return statement`,
    };
    const decide = compile(spec);
    expect(decide(view([], []))).toBe('C');
  });

  it('rejects code exceeding max length', () => {
    const spec: CodeBotSpec = {
      name: 'TooLong',
      version: 1,
      kind: 'code',
      code: 'x'.repeat(CODE_MAX_LENGTH + 1),
    };
    expect(() => compile(spec)).toThrow(/exceeds maximum length/);
  });
});
