// @pdt/backend — schema migration runner.
//
// Phase 1 keeps this dead simple: read every .sql file in
// `apps/backend/migrations/` in lexical order and execute it. Each
// migration script is *itself* idempotent (CREATE TABLE IF NOT EXISTS
// etc.), so re-running on an already-migrated database is harmless
// and we don't need a `schema_migrations` ledger yet.
//
// When the schema starts to require non-idempotent changes (ALTER,
// DROP, data backfills) we'll add a proper migrations table here.

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Sql } from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the migrations directory relative to this file. The .ts
 * source lives at `apps/backend/src/migrate.ts` and migrations live
 * at `apps/backend/migrations/`, so we go up one level.
 */
function migrationsDir(): string {
  return join(__dirname, '..', 'migrations');
}

/**
 * Apply every .sql file in the migrations directory, in lexical
 * order. Returns the list of files that were executed.
 */
export async function runMigrations(sql: Sql): Promise<string[]> {
  const dir = migrationsDir();
  const entries = await readdir(dir);
  const files = entries.filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const path = join(dir, file);
    const body = await readFile(path, 'utf8');
    // `sql.unsafe` is required to run a multi-statement SQL string;
    // the body comes from a file we ship in this repo, never from
    // user input, so there is no injection surface.
    await sql.unsafe(body);
  }

  return files;
}
