// @pdt/backend — BotSpec validator.
//
// Compiles `BOT_SPEC_SCHEMA` once at module load time and exports a
// single helper that takes untrusted JSON and returns either a typed
// `BotSpec` or a list of validation errors. The compiled validator is
// reused across requests so /api/bots throughput stays cheap.
//
// We use Ajv 2020-draft compatibility mode (the default `Ajv` import,
// not `Ajv2020`) because `BOT_SPEC_SCHEMA` declares draft-07. Format
// validators (`date`, `email`, …) aren't needed yet but `ajv-formats`
// is wired up so they're available the moment we add the first one.

import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { BotSpec } from '@pdt/engine';
import { BOT_SPEC_SCHEMA } from './bot-spec-schema.js';

const ajv = new Ajv({
  allErrors: true,
  strict: false, // our schema is hand-rolled; we don't want strict-mode warnings on `$defs`
});
addFormats(ajv);

const validate: ValidateFunction = ajv.compile(BOT_SPEC_SCHEMA);

export interface ValidationError {
  path: string;
  message: string;
}

export type BotSpecValidationResult =
  | { valid: true; spec: BotSpec }
  | { valid: false; errors: ValidationError[] };

/**
 * Validate untrusted JSON against the BotSpec schema. Returns a
 * tagged union so callers can pattern-match without throwing.
 */
export function validateBotSpec(input: unknown): BotSpecValidationResult {
  if (validate(input)) {
    // Ajv has narrowed `input` to the schema's type at runtime; the
    // engine's `BotSpec` type is the same shape, so this assertion is
    // sound.
    return { valid: true, spec: input as BotSpec };
  }
  const errors: ValidationError[] = (validate.errors ?? []).map((e) => ({
    path: e.instancePath || '/',
    message: `${e.message ?? 'invalid'}${
      e.params && Object.keys(e.params).length > 0
        ? ` (${Object.entries(e.params)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(', ')})`
        : ''
    }`,
  }));
  return { valid: false, errors };
}
