// @pdt/backend — Natural-language bot compiler.
//
// Accepts a plain-English strategy description and calls the Anthropic
// API to produce a valid BotSpec JSON object. The flow:
//
//   1. Build a system prompt containing the full JSON Schema, the DSL
//      primitive reference, and several worked examples (Pavlov, Grim,
//      Generous TFT).
//   2. Send the user's description as the user message.
//   3. Parse the JSON from Claude's response.
//   4. Validate against the BotSpec schema.
//   5. If invalid, retry ONCE with the validation errors appended.
//   6. Return the valid BotSpec or an error.
//
// The backend never executes arbitrary code from Claude. It only accepts
// JSON conforming to the schema, and the engine interpreter is the only
// thing that ever acts on it.

import Anthropic from '@anthropic-ai/sdk';
import { BOT_SPEC_SCHEMA } from '../schema/bot-spec-schema.js';
import { validateBotSpec, type ValidationError } from '../schema/validate-bot-spec.js';
import type { BotSpec } from '@pdt/engine';

// Lazy singleton — created on first call so the module can be imported
// without ANTHROPIC_API_KEY being set (e.g. in tests).
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

const MODEL = 'claude-sonnet-4-20250514';

const SYSTEM_PROMPT = `You are a bot compiler for a Prisoner's Dilemma tournament platform. Your job is to convert a natural-language strategy description into a valid BotSpec JSON object.

## JSON Schema

The BotSpec must conform exactly to this schema:

\`\`\`json
${JSON.stringify(BOT_SPEC_SCHEMA, null, 2)}
\`\`\`

## Key rules

- \`version\` must be \`1\`, \`kind\` must be \`"dsl"\`.
- \`initial\` is the move played on round 0 (before any history exists).
- \`rules\` are checked in order; the first matching rule fires. If no rule matches, \`default\` is used.
- Actions are either \`{ "type": "move", "move": "C" }\` (or "D") for deterministic, or \`{ "type": "random", "weights": { "C": 3, "D": 7 } }\` for stochastic (weights are relative, not probabilities).
- Conditions use a tagged-union \`type\` field. Available types: \`always\`, \`and\`, \`or\`, \`not\`, \`opponentLastMove\`, \`myLastMove\`, \`patternInLastN\`, \`classifyOpponent\`, \`round\`, \`myScore\`, \`opponentScore\`, \`opponentDefectionRate\`, \`opponentCooperationRate\`, \`myDefectionRate\`, \`myCooperationRate\`, \`consecutiveDefections\`, \`consecutiveCooperations\`, \`longestRun\`, \`transitionProb\`, \`myTransitionProb\`, \`random\`.
- Numeric comparisons use \`op\` with values: \`eq\`, \`neq\`, \`lt\`, \`lte\`, \`gt\`, \`gte\`.
- \`side\` is either \`"me"\` or \`"opponent"\`.
- \`classifyOpponent\` labels: TFT, TF2T, ALLD, ALLC, RANDOM, GRIM, PAVLOV, GENEROUS_TFT, UNKNOWN.
- Rate conditions (\`opponentDefectionRate\`, etc.) take values 0–1 and an optional \`window\` (integer, recent N rounds).
- \`not\` takes a single condition in \`of\` (not an array).

## Examples

### Tit for Tat
\`\`\`json
{
  "name": "Tit for Tat",
  "version": 1,
  "kind": "dsl",
  "initial": { "type": "move", "move": "C" },
  "rules": [
    {
      "comment": "Mirror opponent's last move — if they defected, defect back.",
      "when": { "type": "opponentLastMove", "equals": "D" },
      "do": { "type": "move", "move": "D" }
    }
  ],
  "default": { "type": "move", "move": "C" }
}
\`\`\`

### Grim Trigger
\`\`\`json
{
  "name": "Grim Trigger",
  "version": 1,
  "kind": "dsl",
  "initial": { "type": "move", "move": "C" },
  "rules": [
    {
      "comment": "Once the opponent has ever defected, defect forever.",
      "when": { "type": "longestRun", "side": "opponent", "move": "D", "op": "gte", "value": 1 },
      "do": { "type": "move", "move": "D" }
    }
  ],
  "default": { "type": "move", "move": "C" }
}
\`\`\`

### Pavlov (Win-Stay, Lose-Shift)
\`\`\`json
{
  "name": "Pavlov",
  "version": 1,
  "kind": "dsl",
  "initial": { "type": "move", "move": "C" },
  "rules": [
    {
      "comment": "CC last round → cooperate (win-stay).",
      "when": { "type": "and", "of": [{ "type": "myLastMove", "equals": "C" }, { "type": "opponentLastMove", "equals": "C" }] },
      "do": { "type": "move", "move": "C" }
    },
    {
      "comment": "DD last round → cooperate (lose-shift from D to C).",
      "when": { "type": "and", "of": [{ "type": "myLastMove", "equals": "D" }, { "type": "opponentLastMove", "equals": "D" }] },
      "do": { "type": "move", "move": "C" }
    }
  ],
  "default": { "type": "move", "move": "D" }
}
\`\`\`

### Generous Tit for Tat
\`\`\`json
{
  "name": "Generous Tit for Tat",
  "version": 1,
  "kind": "dsl",
  "initial": { "type": "move", "move": "C" },
  "rules": [
    {
      "comment": "After an opponent defection, retaliate 90% of the time.",
      "when": { "type": "opponentLastMove", "equals": "D" },
      "do": { "type": "random", "weights": { "C": 1, "D": 9 } }
    }
  ],
  "default": { "type": "move", "move": "C" }
}
\`\`\`

## Output format

Respond with ONLY the JSON object. No markdown fences, no explanation, no preamble. Just the raw JSON.

Give the bot a short, descriptive name based on the strategy (not the user's exact words). Always include helpful \`comment\` fields on rules to explain the logic.`;

export type CompileBotResult =
  | { ok: true; spec: BotSpec }
  | { ok: false; error: string; details?: ValidationError[] };

/**
 * Compile a natural-language strategy description into a BotSpec.
 * Makes at most two API calls (initial + one retry on validation failure).
 */
export async function compileBot(description: string): Promise<CompileBotResult> {
  const api = getClient();

  // First attempt
  const firstResponse = await callClaude(api, description);
  if (!firstResponse.ok) {
    return firstResponse;
  }

  const firstValidation = validateBotSpec(firstResponse.json);
  if (firstValidation.valid) {
    return { ok: true, spec: firstValidation.spec };
  }

  // Retry once with validation errors
  const errorSummary = firstValidation.errors
    .map((e) => `  ${e.path}: ${e.message}`)
    .join('\n');

  const retryResponse = await callClaude(
    api,
    description,
    JSON.stringify(firstResponse.json, null, 2),
    errorSummary,
  );
  if (!retryResponse.ok) {
    return retryResponse;
  }

  const retryValidation = validateBotSpec(retryResponse.json);
  if (retryValidation.valid) {
    return { ok: true, spec: retryValidation.spec };
  }

  return {
    ok: false,
    error: 'The compiled bot failed schema validation even after a retry. You can try rephrasing your description.',
    details: retryValidation.errors,
  };
}

type ClaudeCallResult =
  | { ok: true; json: unknown }
  | { ok: false; error: string };

async function callClaude(
  api: Anthropic,
  description: string,
  previousAttempt?: string,
  validationErrors?: string,
): Promise<ClaudeCallResult> {
  let userMessage = description;

  if (previousAttempt && validationErrors) {
    userMessage = `My strategy description: ${description}

Your previous attempt produced this JSON:
\`\`\`json
${previousAttempt}
\`\`\`

But it failed schema validation with these errors:
${validationErrors}

Please fix the errors and output ONLY the corrected JSON.`;
  }

  let response;
  try {
    response = await api.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Anthropic API error: ${msg}` };
  }

  // Extract text from the response
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    return { ok: false, error: 'No text in Claude response' };
  }

  // Parse JSON — Claude might wrap it in markdown fences despite instructions
  let raw = textBlock.text.trim();
  const fenceMatch = raw.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch?.[1]) {
    raw = fenceMatch[1].trim();
  }

  try {
    const json: unknown = JSON.parse(raw);
    return { ok: true, json };
  } catch {
    return { ok: false, error: `Claude returned invalid JSON: ${raw.slice(0, 200)}…` };
  }
}
