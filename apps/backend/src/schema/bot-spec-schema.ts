// @pdt/backend — JSON Schema for BotSpec.
//
// Mirrors the `BotSpec` / `Condition` / `Action` types declared in
// `packages/engine/src/types.ts`. The engine's TS types are the
// authoritative shape; this schema exists to validate untrusted JSON
// arriving over the wire (POST /api/bots), and to give the (later)
// natural-language compiler a single artefact to validate Claude's
// output against.
//
// Design choices:
//
//  - One file, plain object literal. We don't try to derive the
//    schema from TS types (json-schema-to-ts, typebox, etc.) because
//    the DSL grammar is small enough that hand-writing it once gives
//    us better error messages and zero build-step magic.
//  - Recursive Conditions go through a single `$ref: '#/$defs/condition'`
//    so `and`/`or`/`not` work without duplication.
//  - `kind` is locked to the literal `'dsl'` for now. The discriminator
//    is in the schema from day one so a future `'code'` tier can be
//    added without a breaking change (architecture §4.5).
//  - `additionalProperties: false` on every closed object so a typo
//    in a rule (e.g. `oppoenent` for `opponent`) becomes an error
//    instead of being silently ignored.
//  - String enums for `move`, numeric op, side, classifier label —
//    these match the engine type unions exactly.

const move = { type: 'string', enum: ['C', 'D'] } as const;
const numericOp = { type: 'string', enum: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte'] } as const;
const side = { type: 'string', enum: ['me', 'opponent'] } as const;
const classifierLabel = {
  type: 'string',
  enum: [
    'TFT',
    'TF2T',
    'ALLD',
    'ALLC',
    'RANDOM',
    'GRIM',
    'PAVLOV',
    'GENEROUS_TFT',
    'UNKNOWN',
  ],
} as const;

export const BOT_SPEC_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://pdt.local/schemas/bot-spec.json',
  title: 'BotSpec',
  // Discriminated union on `kind`: 'dsl' or 'code'.
  oneOf: [
    {
      type: 'object',
      required: ['name', 'version', 'kind', 'initial', 'rules', 'default'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 80 },
        author: { type: 'string', maxLength: 80 },
        version: { type: 'integer', minimum: 1 },
        kind: { type: 'string', const: 'dsl' },
        initial: { $ref: '#/$defs/action' },
        rules: {
          type: 'array',
          maxItems: 256,
          items: { $ref: '#/$defs/rule' },
        },
        default: { $ref: '#/$defs/action' },
      },
    },
    {
      type: 'object',
      required: ['name', 'version', 'kind', 'code'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 80 },
        author: { type: 'string', maxLength: 80 },
        version: { type: 'integer', minimum: 1 },
        kind: { type: 'string', const: 'code' },
        code: { type: 'string', minLength: 1, maxLength: 10000 },
      },
    },
  ],

  $defs: {
    move,
    numericOp,
    side,
    classifierLabel,

    // ---- Action: deterministic move OR weighted random draw ----
    action: {
      oneOf: [
        {
          type: 'object',
          required: ['type', 'move'],
          additionalProperties: false,
          properties: {
            type: { const: 'move' },
            move,
          },
        },
        {
          type: 'object',
          required: ['type', 'weights'],
          additionalProperties: false,
          properties: {
            type: { const: 'random' },
            weights: {
              type: 'object',
              required: ['C', 'D'],
              additionalProperties: false,
              properties: {
                C: { type: 'number', minimum: 0 },
                D: { type: 'number', minimum: 0 },
              },
            },
          },
        },
      ],
    },

    // ---- Rule: when -> do ----
    rule: {
      type: 'object',
      required: ['when', 'do'],
      additionalProperties: false,
      properties: {
        comment: { type: 'string', maxLength: 200 },
        when: { $ref: '#/$defs/condition' },
        do: { $ref: '#/$defs/action' },
      },
    },

    // ---- Condition: tagged union (matches interpreter.ts evaluateCondition) ----
    condition: {
      oneOf: [
        // structural / combinators
        {
          type: 'object',
          required: ['type'],
          additionalProperties: false,
          properties: { type: { const: 'always' } },
        },
        {
          type: 'object',
          required: ['type', 'of'],
          additionalProperties: false,
          properties: {
            type: { const: 'and' },
            of: {
              type: 'array',
              minItems: 1,
              maxItems: 32,
              items: { $ref: '#/$defs/condition' },
            },
          },
        },
        {
          type: 'object',
          required: ['type', 'of'],
          additionalProperties: false,
          properties: {
            type: { const: 'or' },
            of: {
              type: 'array',
              minItems: 1,
              maxItems: 32,
              items: { $ref: '#/$defs/condition' },
            },
          },
        },
        {
          type: 'object',
          required: ['type', 'of'],
          additionalProperties: false,
          properties: {
            type: { const: 'not' },
            of: { $ref: '#/$defs/condition' },
          },
        },

        // direct equality on the latest move
        {
          type: 'object',
          required: ['type', 'equals'],
          additionalProperties: false,
          properties: {
            type: { const: 'opponentLastMove' },
            equals: move,
          },
        },
        {
          type: 'object',
          required: ['type', 'equals'],
          additionalProperties: false,
          properties: {
            type: { const: 'myLastMove' },
            equals: move,
          },
        },

        // pattern in trailing window
        {
          type: 'object',
          required: ['type', 'side', 'n', 'pattern'],
          additionalProperties: false,
          properties: {
            type: { const: 'patternInLastN' },
            side,
            n: { type: 'integer', minimum: 1, maximum: 64 },
            pattern: {
              type: 'array',
              minItems: 1,
              maxItems: 64,
              items: move,
            },
          },
        },

        // built-in classifier
        {
          type: 'object',
          required: ['type', 'equals'],
          additionalProperties: false,
          properties: {
            type: { const: 'classifyOpponent' },
            equals: classifierLabel,
          },
        },

        // round counter
        {
          type: 'object',
          required: ['type', 'op', 'value'],
          additionalProperties: false,
          properties: {
            type: { const: 'round' },
            op: numericOp,
            value: { type: 'integer', minimum: 0 },
          },
        },

        // scores
        {
          type: 'object',
          required: ['type', 'op', 'value'],
          additionalProperties: false,
          properties: {
            type: { const: 'myScore' },
            op: numericOp,
            value: { type: 'number' },
          },
        },
        {
          type: 'object',
          required: ['type', 'op', 'value'],
          additionalProperties: false,
          properties: {
            type: { const: 'opponentScore' },
            op: numericOp,
            value: { type: 'number' },
          },
        },

        // cooperation / defection rates (windowable)
        ...(['opponentDefectionRate', 'opponentCooperationRate', 'myDefectionRate', 'myCooperationRate'].map(
          (t) => ({
            type: 'object',
            required: ['type', 'op', 'value'],
            additionalProperties: false,
            properties: {
              type: { const: t },
              op: numericOp,
              value: { type: 'number', minimum: 0, maximum: 1 },
              window: { type: 'integer', minimum: 1, maximum: 10000 },
            },
          }),
        ) as object[]),

        // streaks
        {
          type: 'object',
          required: ['type', 'side', 'op', 'value'],
          additionalProperties: false,
          properties: {
            type: { const: 'consecutiveDefections' },
            side,
            op: numericOp,
            value: { type: 'integer', minimum: 0 },
          },
        },
        {
          type: 'object',
          required: ['type', 'side', 'op', 'value'],
          additionalProperties: false,
          properties: {
            type: { const: 'consecutiveCooperations' },
            side,
            op: numericOp,
            value: { type: 'integer', minimum: 0 },
          },
        },
        {
          type: 'object',
          required: ['type', 'side', 'move', 'op', 'value'],
          additionalProperties: false,
          properties: {
            type: { const: 'longestRun' },
            side,
            move,
            op: numericOp,
            value: { type: 'integer', minimum: 0 },
          },
        },

        // transition probabilities
        {
          type: 'object',
          required: ['type', 'from', 'to', 'op', 'value'],
          additionalProperties: false,
          properties: {
            type: { const: 'transitionProb' },
            from: move,
            to: move,
            op: numericOp,
            value: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
        {
          type: 'object',
          required: ['type', 'from', 'to', 'op', 'value'],
          additionalProperties: false,
          properties: {
            type: { const: 'myTransitionProb' },
            from: move,
            to: move,
            op: numericOp,
            value: { type: 'number', minimum: 0, maximum: 1 },
          },
        },

        // fresh RNG draw
        {
          type: 'object',
          required: ['type', 'op', 'value'],
          additionalProperties: false,
          properties: {
            type: { const: 'random' },
            op: numericOp,
            value: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      ],
    },
  },
} as const;
