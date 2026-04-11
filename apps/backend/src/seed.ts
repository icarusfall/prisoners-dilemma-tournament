// @pdt/backend — preset bot seeder.
//
// Writes the eight classical preset BotSpecs from `@pdt/engine` into
// the `bots` table on backend boot. Idempotent: an `ON CONFLICT DO
// NOTHING` upsert means re-running on a populated database is a
// no-op, and updating a preset's spec in code does NOT clobber a
// preset row that's already there (we'd want a deliberate migration
// for that, since changing a preset's spec invalidates any tournament
// result that referenced it by id).
//
// Bot ids are the lowercased preset id — so 'TFT' → 'tft', 'GENEROUS_TFT'
// → 'generous_tft'. These are stable, human-readable, and match what
// the frontend bot picker will reference.

import type { Sql } from 'postgres';
import { PRESETS } from '@pdt/engine';

// `postgres.json` accepts any JSON-shaped value but its TypeScript
// type is the structural `JSONValue`. A `BotSpec` is JSON-serialisable
// by construction but the compiler can't see that, so we tell it.
type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [k: string]: JsonValue };

/**
 * Seed the eight preset bots. Returns the ids of bots that were
 * actually inserted (i.e. those that didn't already exist).
 */
export async function seedPresets(sql: Sql): Promise<string[]> {
  const inserted: string[] = [];

  for (const preset of PRESETS) {
    const id = preset.id.toLowerCase();
    const result = await sql<{ id: string }[]>`
      INSERT INTO bots (id, player_id, name, spec, created_via, source_description)
      VALUES (
        ${id},
        ${null},
        ${preset.name},
        ${sql.json(preset.spec as unknown as JsonValue)},
        ${'preset'},
        ${preset.description}
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    if (result.length > 0) inserted.push(id);
  }

  return inserted;
}
