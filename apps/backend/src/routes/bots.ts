// @pdt/backend — /api/bots routes.
//
// CRUD over the `bots` table. Two creation paths:
//
//   POST /api/bots { presetId, name? }
//     Clones one of the eight built-in presets. The cloned bot gets a
//     fresh id (`{presetId}_{random}`) and `created_via = 'preset'`.
//     The user can override the display name; otherwise we copy the
//     preset's name.
//
//   POST /api/bots { name, spec, source_description?, created_via? }
//     Direct submission of a hand-written or NL-compiled BotSpec.
//     The spec is validated against `BOT_SPEC_SCHEMA` before any DB
//     write happens. `created_via` defaults to 'nl'.
//
// Listing is filterable by `created_via` and `author`. Single-bot
// fetch is by id; deletion is allowed for everything *except* preset
// bots, because deleting a preset would silently invalidate any
// tournament result that referenced it (the foreign key in
// `tournament_entries` and `matches` does cascade, but we'd lose
// historical leaderboards). The /seed flow can re-create a deleted
// preset on next boot, but only if no tournament entries reference
// it — so we just block the delete outright.

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Sql } from 'postgres';
import { getPreset, type PresetId } from '@pdt/engine';
import type { BotSpec } from '@pdt/engine';
import { validateBotSpec } from '../schema/validate-bot-spec.js';
import { generateBotId } from '../util/ids.js';

interface BotRow {
  id: string;
  player_id: string | null;
  name: string;
  spec: BotSpec;
  created_via: string;
  source_description: string | null;
  created_at: Date;
}

interface BotsRouteOptions {
  sql: Sql;
}

const PRESET_IDS_LOWER = new Set<string>([
  'allc',
  'alld',
  'tft',
  'tf2t',
  'grim',
  'pavlov',
  'generous_tft',
  'random',
]);

function presetIdFromInput(input: string): PresetId | null {
  const upper = input.toUpperCase();
  if (
    upper === 'ALLC' ||
    upper === 'ALLD' ||
    upper === 'TFT' ||
    upper === 'TF2T' ||
    upper === 'GRIM' ||
    upper === 'PAVLOV' ||
    upper === 'GENEROUS_TFT' ||
    upper === 'RANDOM'
  ) {
    return upper;
  }
  return null;
}

const ALLOWED_CREATED_VIA = new Set(['preset', 'nl', 'mcp']);

export const botsRoutes: FastifyPluginAsync<BotsRouteOptions> = async (
  app: FastifyInstance,
  opts: BotsRouteOptions,
) => {
  const { sql } = opts;

  // ---------------------------------------------------------------
  // GET /api/bots — list, with optional filters
  // ---------------------------------------------------------------
  app.get<{
    Querystring: { created_via?: string; author?: string };
  }>('/api/bots', async (req, reply) => {
    const { created_via, author } = req.query;

    if (created_via !== undefined && !ALLOWED_CREATED_VIA.has(created_via)) {
      return reply.code(400).send({
        error: 'invalid_query',
        message: `created_via must be one of: preset, nl, mcp`,
      });
    }

    // Build the WHERE clause as conditional fragments. The `postgres`
    // driver supports composable fragments via `sql\`...\`` returning
    // values that can be embedded in another tagged template.
    let rows: BotRow[];
    if (created_via && author) {
      rows = await sql<BotRow[]>`
        SELECT id, player_id, name, spec, created_via, source_description, created_at
        FROM bots
        WHERE created_via = ${created_via}
          AND spec->>'author' = ${author}
        ORDER BY created_at DESC, id ASC
      `;
    } else if (created_via) {
      rows = await sql<BotRow[]>`
        SELECT id, player_id, name, spec, created_via, source_description, created_at
        FROM bots
        WHERE created_via = ${created_via}
        ORDER BY created_at DESC, id ASC
      `;
    } else if (author) {
      rows = await sql<BotRow[]>`
        SELECT id, player_id, name, spec, created_via, source_description, created_at
        FROM bots
        WHERE spec->>'author' = ${author}
        ORDER BY created_at DESC, id ASC
      `;
    } else {
      rows = await sql<BotRow[]>`
        SELECT id, player_id, name, spec, created_via, source_description, created_at
        FROM bots
        ORDER BY created_at DESC, id ASC
      `;
    }

    return { bots: rows };
  });

  // ---------------------------------------------------------------
  // GET /api/bots/:id
  // ---------------------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/bots/:id', async (req, reply) => {
    const { id } = req.params;
    const rows = await sql<BotRow[]>`
      SELECT id, player_id, name, spec, created_via, source_description, created_at
      FROM bots
      WHERE id = ${id}
    `;
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'not_found', message: `no bot with id ${id}` });
    }
    return rows[0];
  });

  // ---------------------------------------------------------------
  // POST /api/bots
  // ---------------------------------------------------------------
  app.post<{
    Body: {
      presetId?: string;
      name?: string;
      spec?: unknown;
      source_description?: string;
      created_via?: string;
    };
  }>('/api/bots', async (req, reply) => {
    const body = req.body ?? {};

    // ---- Path A: clone a preset ----
    if (body.presetId !== undefined) {
      if (body.spec !== undefined) {
        return reply.code(400).send({
          error: 'invalid_body',
          message: 'pass either presetId OR spec, not both',
        });
      }
      const presetId = presetIdFromInput(body.presetId);
      if (!presetId) {
        return reply.code(400).send({
          error: 'invalid_preset',
          message: `unknown presetId "${body.presetId}"`,
        });
      }
      const preset = getPreset(presetId);
      const id = generateBotId(presetId.toLowerCase());
      const name = body.name ?? preset.name;
      const inserted = await sql<BotRow[]>`
        INSERT INTO bots (id, player_id, name, spec, created_via, source_description)
        VALUES (
          ${id},
          ${null},
          ${name},
          ${sql.json(preset.spec as unknown as Parameters<typeof sql.json>[0])},
          ${'preset'},
          ${preset.description}
        )
        RETURNING id, player_id, name, spec, created_via, source_description, created_at
      `;
      return reply.code(201).send(inserted[0]);
    }

    // ---- Path B: direct spec submission ----
    if (body.spec === undefined) {
      return reply.code(400).send({
        error: 'invalid_body',
        message: 'must provide either presetId or spec',
      });
    }
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return reply.code(400).send({
        error: 'invalid_body',
        message: 'name is required when submitting a spec directly',
      });
    }

    const result = validateBotSpec(body.spec);
    if (!result.valid) {
      return reply.code(400).send({
        error: 'invalid_spec',
        message: 'spec failed schema validation',
        errors: result.errors,
      });
    }

    const createdVia = body.created_via ?? 'nl';
    if (!ALLOWED_CREATED_VIA.has(createdVia) || createdVia === 'preset') {
      return reply.code(400).send({
        error: 'invalid_created_via',
        message: `created_via must be 'nl' or 'mcp' for direct submissions`,
      });
    }

    const id = generateBotId('bot');
    const inserted = await sql<BotRow[]>`
      INSERT INTO bots (id, player_id, name, spec, created_via, source_description)
      VALUES (
        ${id},
        ${null},
        ${body.name.trim()},
        ${sql.json(result.spec as unknown as Parameters<typeof sql.json>[0])},
        ${createdVia},
        ${body.source_description ?? null}
      )
      RETURNING id, player_id, name, spec, created_via, source_description, created_at
    `;
    return reply.code(201).send(inserted[0]);
  });

  // ---------------------------------------------------------------
  // DELETE /api/bots/:id
  // ---------------------------------------------------------------
  app.delete<{ Params: { id: string } }>('/api/bots/:id', async (req, reply) => {
    const { id } = req.params;

    // Block deletion of presets — they're a stable reference set the
    // frontend bot picker depends on, and removing one would either
    // require a re-seed at next boot (only safe if no tournament
    // result references it) or invalidate historical leaderboards.
    // Re-seeding the preset by name would also be confusing because
    // the seed uses lowercased ids (`tft`, `allc`, …) so the row's
    // own id is the cleanest way to detect a preset.
    if (PRESET_IDS_LOWER.has(id)) {
      return reply.code(403).send({
        error: 'preset_protected',
        message: `preset bot "${id}" cannot be deleted`,
      });
    }

    const deleted = await sql<{ id: string }[]>`
      DELETE FROM bots WHERE id = ${id} RETURNING id
    `;
    if (deleted.length === 0) {
      return reply.code(404).send({ error: 'not_found', message: `no bot with id ${id}` });
    }
    return reply.code(204).send();
  });
};
