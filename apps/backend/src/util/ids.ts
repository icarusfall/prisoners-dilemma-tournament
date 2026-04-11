// @pdt/backend — bot id generator.
//
// Bot ids are short, URL-safe, human-skimmable strings of the form
// `${prefix}_${random}` where the random suffix is 8 base32 chars
// (40 bits of entropy — collision-free for the lifetime of an AI Club
// challenge with a few hundred bots). We avoid pulling in `nanoid`
// or `uuid` because Node 22's built-in `crypto.randomBytes` is enough.

import { randomBytes } from 'node:crypto';

// Lower-case Crockford base32 (no l, o, u, i to avoid ambiguity).
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

function randomSuffix(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

/**
 * Generate a bot id with the given prefix. Caller is responsible for
 * passing a stable, lowercase prefix (e.g. 'bot', 'tft' for a TFT
 * clone) — the function does NOT sanitise it.
 */
export function generateBotId(prefix: string): string {
  return `${prefix}_${randomSuffix(8)}`;
}
