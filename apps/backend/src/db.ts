// @pdt/backend — Postgres client.
//
// Single shared `postgres` instance configured from `DATABASE_URL`.
// We use the porsager driver (pure JS, no native compilation) so the
// backend builds cleanly on Railway's Nixpacks image *and* on a
// developer laptop without C++ build tools.
//
// One process = one connection pool. The driver is lazy: nothing
// connects until the first query, so importing this file is cheap.
// `closeDb()` is exposed for tests / graceful shutdown.

import postgres, { type Sql } from 'postgres';

let sqlSingleton: Sql | null = null;

/**
 * Return the shared `postgres` client, creating it on first call.
 * Throws if `DATABASE_URL` is not set — we never silently fall back
 * to a default, because that would mask a missing-env-var bug in
 * production.
 */
export function getDb(): Sql {
  if (sqlSingleton) return sqlSingleton;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }

  sqlSingleton = postgres(url, {
    // Modest pool size — Railway hobby Postgres caps at ~20 connections,
    // and the backend is single-process so we don't need more.
    max: 5,
    // Railway's managed Postgres requires TLS but their internal
    // certificate isn't in Node's default trust store. `require` is
    // the standard pragmatic setting for managed cloud Postgres.
    ssl: 'require',
    // Slightly louder timeouts than the defaults so a hung query
    // doesn't wedge the whole backend forever.
    idle_timeout: 30,
    connect_timeout: 10,
  });

  return sqlSingleton;
}

/** Close the shared client. Safe to call multiple times. */
export async function closeDb(): Promise<void> {
  if (sqlSingleton) {
    await sqlSingleton.end({ timeout: 5 });
    sqlSingleton = null;
  }
}
