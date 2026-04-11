import { describe, it, expectTypeOf } from 'vitest';
import type {
  Move,
  BotView,
  DecisionFn,
  BotInstance,
  BotSpec,
  Condition,
  Action,
  Rule,
  TournamentResult,
  EvolutionaryResult,
} from '../src/types.js';

// Type-only smoke tests. These never run anything at runtime; they exist
// purely to assert that the public types compose the way the rest of the
// engine (and the backend / frontend / MCP server) will expect.

describe('engine type surface', () => {
  it('Move is the C/D union', () => {
    expectTypeOf<Move>().toEqualTypeOf<'C' | 'D'>();
  });

  it('a DecisionFn maps a BotView to a Move', () => {
    const decide: DecisionFn = (view: BotView) => (view.round === 0 ? 'C' : 'D');
    expectTypeOf(decide).toMatchTypeOf<(v: BotView) => Move>();
  });

  it('a minimal valid BotSpec compiles', () => {
    const tft: BotSpec = {
      name: 'TFT',
      version: 1,
      kind: 'dsl',
      initial: { type: 'move', move: 'C' },
      rules: [
        {
          comment: 'mirror opponent',
          when: { type: 'opponentLastMove', equals: 'D' },
          do: { type: 'move', move: 'D' },
        },
      ],
      default: { type: 'move', move: 'C' },
    };
    expectTypeOf(tft).toMatchTypeOf<BotSpec>();
  });

  it('Condition is a discriminated union over `type`', () => {
    const conditions: Condition[] = [
      { type: 'always' },
      { type: 'and', of: [{ type: 'always' }, { type: 'always' }] },
      { type: 'not', of: { type: 'always' } },
      { type: 'opponentLastMove', equals: 'D' },
      { type: 'round', op: 'gte', value: 10 },
      { type: 'opponentDefectionRate', op: 'gt', value: 0.5, window: 20 },
      { type: 'transitionProb', from: 'D', to: 'C', op: 'gte', value: 0.8 },
      { type: 'classifyOpponent', equals: 'TFT' },
      { type: 'patternInLastN', side: 'opponent', n: 3, pattern: ['D', 'D', 'D'] },
      { type: 'random', op: 'lt', value: 0.1 },
    ];
    expectTypeOf(conditions).toMatchTypeOf<Condition[]>();
  });

  it('Action covers deterministic and stochastic moves', () => {
    const a1: Action = { type: 'move', move: 'C' };
    const a2: Action = { type: 'random', weights: { C: 0.7, D: 0.3 } };
    expectTypeOf(a1).toMatchTypeOf<Action>();
    expectTypeOf(a2).toMatchTypeOf<Action>();
  });

  it('a BotInstance bundles spec + compiled decide fn', () => {
    expectTypeOf<BotInstance['instanceId']>().toEqualTypeOf<string>();
    expectTypeOf<BotInstance['decide']>().toEqualTypeOf<DecisionFn>();
  });

  it('TournamentResult and EvolutionaryResult are distinguishable by `mode`', () => {
    type Modes = TournamentResult['mode'] | EvolutionaryResult['mode'];
    expectTypeOf<Modes>().toEqualTypeOf<'round-robin' | 'evolutionary'>();
  });

  // Used to keep the imports for `Rule` referenced.
  it('Rule has when/do', () => {
    expectTypeOf<Rule['when']>().toEqualTypeOf<Condition>();
    expectTypeOf<Rule['do']>().toEqualTypeOf<Action>();
  });
});
