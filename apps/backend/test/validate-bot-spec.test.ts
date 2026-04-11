import { describe, it, expect } from 'vitest';
import { PRESETS } from '@pdt/engine';
import { validateBotSpec } from '../src/schema/validate-bot-spec.js';

describe('validateBotSpec — accepts every preset', () => {
  for (const preset of PRESETS) {
    it(`accepts the ${preset.id} preset`, () => {
      const result = validateBotSpec(preset.spec);
      if (!result.valid) {
        // Surface the errors so a failure is debuggable.
        throw new Error(
          `expected ${preset.id} to validate, but got: ${JSON.stringify(result.errors, null, 2)}`,
        );
      }
      expect(result.valid).toBe(true);
    });
  }
});

describe('validateBotSpec — rejects malformed input', () => {
  it('rejects a non-object', () => {
    expect(validateBotSpec('hello').valid).toBe(false);
    expect(validateBotSpec(null).valid).toBe(false);
    expect(validateBotSpec(42).valid).toBe(false);
  });

  it('rejects a missing required top-level field', () => {
    const r = validateBotSpec({
      name: 'Bad',
      version: 1,
      kind: 'dsl',
      // missing initial
      rules: [],
      default: { type: 'move', move: 'C' },
    });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.errors.some((e) => e.message.includes('initial'))).toBe(true);
    }
  });

  it('rejects an unknown kind', () => {
    const r = validateBotSpec({
      name: 'Bad',
      version: 1,
      kind: 'wasm',
      initial: { type: 'move', move: 'C' },
      rules: [],
      default: { type: 'move', move: 'C' },
    });
    expect(r.valid).toBe(false);
  });

  it('rejects an unknown condition type', () => {
    const r = validateBotSpec({
      name: 'Bad',
      version: 1,
      kind: 'dsl',
      initial: { type: 'move', move: 'C' },
      rules: [
        { when: { type: 'NOT_A_REAL_PRIMITIVE' }, do: { type: 'move', move: 'D' } },
      ],
      default: { type: 'move', move: 'C' },
    });
    expect(r.valid).toBe(false);
  });

  it('rejects an extra property on a closed object (typo guard)', () => {
    const r = validateBotSpec({
      name: 'Bad',
      version: 1,
      kind: 'dsl',
      initial: { type: 'move', move: 'C' },
      rules: [
        {
          when: { type: 'opponentLastMove', equlas: 'D' /* typo */ },
          do: { type: 'move', move: 'D' },
        },
      ],
      default: { type: 'move', move: 'C' },
    });
    expect(r.valid).toBe(false);
  });

  it('rejects an out-of-range numeric value', () => {
    const r = validateBotSpec({
      name: 'Bad',
      version: 1,
      kind: 'dsl',
      initial: { type: 'move', move: 'C' },
      rules: [
        {
          when: {
            type: 'opponentDefectionRate',
            op: 'gte',
            value: 1.5, // schema enforces 0..1
          },
          do: { type: 'move', move: 'D' },
        },
      ],
      default: { type: 'move', move: 'C' },
    });
    expect(r.valid).toBe(false);
  });

  it('accepts a hand-crafted spec that uses every primitive family', () => {
    const r = validateBotSpec({
      name: 'Kitchen sink',
      author: 'test',
      version: 1,
      kind: 'dsl',
      initial: { type: 'random', weights: { C: 1, D: 1 } },
      rules: [
        { when: { type: 'always' }, do: { type: 'move', move: 'C' } },
        {
          when: {
            type: 'and',
            of: [
              { type: 'opponentLastMove', equals: 'D' },
              { type: 'not', of: { type: 'myLastMove', equals: 'D' } },
              { type: 'round', op: 'gte', value: 5 },
              {
                type: 'patternInLastN',
                side: 'opponent',
                n: 2,
                pattern: ['D', 'D'],
              },
              { type: 'classifyOpponent', equals: 'TFT' },
              { type: 'transitionProb', from: 'C', to: 'D', op: 'gt', value: 0.3 },
              { type: 'longestRun', side: 'me', move: 'C', op: 'gte', value: 3 },
              { type: 'random', op: 'lt', value: 0.1 },
            ],
          },
          do: { type: 'random', weights: { C: 1, D: 9 } },
        },
      ],
      default: { type: 'move', move: 'C' },
    });
    if (!r.valid) {
      throw new Error(`expected kitchen-sink spec to validate: ${JSON.stringify(r.errors, null, 2)}`);
    }
    expect(r.valid).toBe(true);
  });
});
