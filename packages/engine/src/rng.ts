// Deterministic pseudo-random number generators.
//
// We use mulberry32: a tiny, fast, well-mixed 32-bit PRNG. It is more
// than good enough for tournament reproducibility (we are not doing
// cryptography or scientific Monte Carlo) and crucially is the same
// algorithm cross-platform, so a `(seed, instances, rounds)` triple
// always produces the same match results no matter where the engine
// runs (browser, node, CI, …).
//
// See architecture.md §3.1 — randomness is injected per instance via
// `BotView.rng`, and instance RNGs are derived from `(matchSeed,
// instanceIndex)` so two bots in the same match cannot influence each
// other's random draws.

/** Build a mulberry32 PRNG seeded by `seed`. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive a per-instance seed from a match seed and an instance index.
 *
 * Uses a small mixing step (xorshift32 + multiply) so adjacent indices
 * produce well-separated seeds — important so instance 0 and instance 1
 * never share an RNG stream prefix.
 */
export function deriveInstanceSeed(matchSeed: number, instanceIndex: number): number {
  let x = (matchSeed ^ (instanceIndex + 0x9e3779b9)) >>> 0;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  return Math.imul(x, 0x85ebca6b) >>> 0;
}
