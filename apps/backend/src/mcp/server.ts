// @pdt/backend — MCP server (Phase 5).
//
// Exposes the tournament platform to any MCP-capable client (Claude
// Desktop, Claude Code, etc.) via the Streamable HTTP transport.
//
// Architecture doc §7:
//   - Tools: submit_bot, validate_bot_spec, list_my_bots, update_bot,
//     delete_bot, run_tournament, get_leaderboard, get_match_history
//   - Resources: pd://docs/*, pd://schema/bot-spec.json,
//     pd://presets/*, pd://scoring
//   - Prompts: start_building_a_bot, analyse_my_bot_performance
//
// Auth: per-player token in the `x-pdt-token` header. The transport
// extracts it and attaches it to the request context. Tools that need
// a player identity look it up from the DB.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Sql } from 'postgres';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  PRESETS,
  PAYOFFS,
  compile,
  runTournament,
  runEvolutionaryTournament,
  type BotSpec,
  type BotInstance,
  type EvolutionaryEntry,
} from '@pdt/engine';
import { BOT_SPEC_SCHEMA } from '../schema/bot-spec-schema.js';
import { validateBotSpec } from '../schema/validate-bot-spec.js';
import { generateBotId } from '../util/ids.js';

// ---- Types ----

interface BotRow {
  id: string;
  player_id: string | null;
  name: string;
  spec: BotSpec;
  created_via: string;
  source_description: string | null;
  created_at: Date;
}

interface TournamentRow {
  id: string;
  name: string | null;
  mode: string;
  result: unknown;
  created_at: Date;
}

interface MatchRow {
  id: string;
  tournament_id: string;
  bot_a_id: string;
  bot_b_id: string;
  score_a: number;
  score_b: number;
  rounds: unknown;
}

// ---- Resolve docs path ----
// We're in apps/backend/src/mcp/server.ts at runtime (via tsx), so
// docs/explainers is at ../../../../docs/explainers relative to this file.
// Use process.cwd() which is the repo root when started normally.
function docsDir(): string {
  return path.join(process.cwd(), 'docs', 'explainers');
}

// ---- Create MCP server ----

export function createMcpServer(sql: Sql): McpServer {
  const mcp = new McpServer(
    {
      name: 'Prisoner\'s Dilemma Tournament',
      version: '1.0.0',
    },
    {
      capabilities: {
        resources: {},
        tools: {},
        prompts: {},
      },
    },
  );

  // ==================================================================
  // Helper: resolve player from token
  // ==================================================================
  async function resolvePlayer(token: string | undefined): Promise<{ id: string; display_name: string } | null> {
    if (!token) return null;
    const rows = await sql<{ id: string; display_name: string }[]>`
      SELECT id, display_name FROM players WHERE mcp_token = ${token}
    `;
    return rows[0] ?? null;
  }

  // ==================================================================
  // TOOLS
  // ==================================================================

  // ---- validate_bot_spec ----
  mcp.tool(
    'validate_bot_spec',
    'Dry-run validation of a BotSpec against the JSON Schema. Use this to check your work before submitting.',
    { spec: z.record(z.string(), z.unknown()).describe('The BotSpec JSON object to validate') },
    async ({ spec }) => {
      const result = validateBotSpec(spec);
      if (result.valid) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ ok: false, errors: result.errors }),
        }],
      };
    },
  );

  // ---- submit_bot ----
  mcp.tool(
    'submit_bot',
    'Submit a new bot to the tournament. The spec must conform to the BotSpec JSON Schema.',
    {
      spec: z.record(z.string(), z.unknown()).describe('The BotSpec JSON object'),
      player_token: z.string().optional().describe('Your player token for ownership attribution'),
    },
    async ({ spec, player_token }) => {
      const validation = validateBotSpec(spec);
      if (!validation.valid) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'invalid_spec',
              message: 'Spec failed schema validation',
              errors: validation.errors,
            }),
          }],
          isError: true,
        };
      }

      const player = await resolvePlayer(player_token);
      const id = generateBotId('bot');
      const inserted = await sql<BotRow[]>`
        INSERT INTO bots (id, player_id, name, spec, created_via, source_description)
        VALUES (
          ${id},
          ${player?.id ?? null},
          ${validation.spec.name},
          ${sql.json(validation.spec as unknown as Parameters<typeof sql.json>[0])},
          ${'mcp'},
          ${null}
        )
        RETURNING id, player_id, name, spec, created_via, source_description, created_at
      `;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ botId: inserted[0]!.id, name: inserted[0]!.name }),
        }],
      };
    },
  );

  // ---- list_my_bots ----
  mcp.tool(
    'list_my_bots',
    'List bots. If a player_token is provided, shows only that player\'s bots. Otherwise shows all bots.',
    {
      player_token: z.string().optional().describe('Your player token to filter to your bots'),
    },
    async ({ player_token }) => {
      let rows: BotRow[];
      if (player_token) {
        const player = await resolvePlayer(player_token);
        if (!player) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'invalid_token', message: 'No player found for this token' }) }],
            isError: true,
          };
        }
        rows = await sql<BotRow[]>`
          SELECT id, player_id, name, spec, created_via, source_description, created_at
          FROM bots WHERE player_id = ${player.id}
          ORDER BY created_at DESC
        `;
      } else {
        rows = await sql<BotRow[]>`
          SELECT id, player_id, name, spec, created_via, source_description, created_at
          FROM bots ORDER BY created_at DESC
        `;
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ bots: rows.map((r) => ({ id: r.id, name: r.name, created_via: r.created_via, created_at: r.created_at })) }),
        }],
      };
    },
  );

  // ---- update_bot ----
  mcp.tool(
    'update_bot',
    'Update an existing bot\'s spec. Cannot update preset bots.',
    {
      bot_id: z.string().describe('The bot ID to update'),
      spec: z.record(z.string(), z.unknown()).describe('The new BotSpec JSON object'),
    },
    async ({ bot_id, spec }) => {
      const validation = validateBotSpec(spec);
      if (!validation.valid) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'invalid_spec', errors: validation.errors }) }],
          isError: true,
        };
      }

      const existing = await sql<BotRow[]>`SELECT id, created_via FROM bots WHERE id = ${bot_id}`;
      if (existing.length === 0) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'not_found' }) }], isError: true };
      }
      if (existing[0]!.created_via === 'preset') {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'preset_protected', message: 'Cannot update preset bots' }) }], isError: true };
      }

      await sql`
        UPDATE bots SET
          name = ${validation.spec.name},
          spec = ${sql.json(validation.spec as unknown as Parameters<typeof sql.json>[0])}
        WHERE id = ${bot_id}
      `;

      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, botId: bot_id }) }] };
    },
  );

  // ---- delete_bot ----
  mcp.tool(
    'delete_bot',
    'Delete a bot. Cannot delete preset bots.',
    {
      bot_id: z.string().describe('The bot ID to delete'),
    },
    async ({ bot_id }) => {
      const existing = await sql<BotRow[]>`SELECT id, created_via FROM bots WHERE id = ${bot_id}`;
      if (existing.length === 0) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'not_found' }) }], isError: true };
      }
      if (existing[0]!.created_via === 'preset') {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'preset_protected' }) }], isError: true };
      }

      await sql`DELETE FROM bots WHERE id = ${bot_id}`;
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
    },
  );

  // ---- run_tournament ----
  mcp.tool(
    'run_tournament',
    'Run a hypothetical tournament without persisting results. Great for testing strategies against each other.',
    {
      instances: z.array(z.object({
        bot_id: z.string(),
        count: z.number().int().min(1).max(50),
      })).min(2).describe('Array of { bot_id, count } specifying which bots and how many copies'),
      mode: z.enum(['round-robin', 'evolutionary']).default('round-robin'),
      rounds_per_match: z.number().int().min(1).max(10000).default(200),
      generations: z.number().int().min(1).max(1000).optional().describe('For evolutionary mode only'),
    },
    async ({ instances, mode, rounds_per_match, generations }) => {
      // Fetch bot specs
      const botIds = [...new Set(instances.map((i) => i.bot_id))];
      const botRows = await sql<BotRow[]>`
        SELECT id, name, spec FROM bots WHERE id = ANY(${botIds})
      `;
      const botMap = new Map(botRows.map((r) => [r.id, r]));

      const missing = botIds.filter((id) => !botMap.has(id));
      if (missing.length > 0) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'bots_not_found', missing }) }],
          isError: true,
        };
      }

      // Build bot instances
      const botInstances: BotInstance[] = [];
      for (const inst of instances) {
        const bot = botMap.get(inst.bot_id)!;
        const decide = compile(bot.spec);
        for (let i = 0; i < inst.count; i++) {
          botInstances.push({
            botId: bot.id,
            instanceId: inst.count > 1 ? `${bot.id}#${i + 1}` : bot.id,
            spec: bot.spec,
            decide,
          });
        }
      }

      const seed = Math.floor(Math.random() * 2 ** 32);

      if (mode === 'evolutionary') {
        const entries: EvolutionaryEntry[] = instances.map((inst) => {
          const bot = botMap.get(inst.bot_id)!;
          return { botId: bot.id, spec: bot.spec, initialShare: inst.count };
        });
        const result = runEvolutionaryTournament(
          entries,
          rounds_per_match,
          generations ?? 50,
          seed,
        );
        // Return summary, not full result (too large)
        const lastGen = result.generations[result.generations.length - 1];
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              mode: 'evolutionary',
              totalGenerations: result.generations.length,
              generation1Winner: result.generation1Winner,
              dominanceWinner: result.dominanceWinner,
              finalPopulation: lastGen?.population,
              extinctEver: result.extinctEver,
            }),
          }],
        };
      }

      // Round-robin
      const result = runTournament(botInstances, rounds_per_match, seed);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            mode: 'round-robin',
            leaderboard: result.leaderboard,
            matchCount: result.matches.length,
            seed: result.seed,
          }),
        }],
      };
    },
  );

  // ---- get_leaderboard ----
  mcp.tool(
    'get_leaderboard',
    'Get the leaderboard from a persisted tournament.',
    {
      tournament_id: z.string().describe('Tournament ID'),
    },
    async ({ tournament_id }) => {
      const rows = await sql<TournamentRow[]>`
        SELECT id, name, mode, result, created_at FROM tournaments WHERE id = ${tournament_id}
      `;
      if (rows.length === 0) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'not_found' }) }], isError: true };
      }
      const t = rows[0]!;
      const result = t.result as { leaderboard?: unknown; generations?: Array<{ leaderboard?: unknown }> };
      const leaderboard = result.leaderboard ?? result.generations?.[0]?.leaderboard;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ tournament_id: t.id, mode: t.mode, leaderboard }),
        }],
      };
    },
  );

  // ---- get_match_history ----
  mcp.tool(
    'get_match_history',
    'Get match history for a bot in a tournament, optionally filtered to a specific opponent.',
    {
      tournament_id: z.string().describe('Tournament ID'),
      bot_id: z.string().describe('Bot ID to get matches for'),
      opponent_id: z.string().optional().describe('Optional opponent bot ID to filter to'),
    },
    async ({ tournament_id, bot_id, opponent_id }) => {
      let matches: MatchRow[];
      if (opponent_id) {
        matches = await sql<MatchRow[]>`
          SELECT id, tournament_id, bot_a_id, bot_b_id, score_a, score_b, rounds
          FROM matches
          WHERE tournament_id = ${tournament_id}
            AND ((bot_a_id = ${bot_id} AND bot_b_id = ${opponent_id})
              OR (bot_a_id = ${opponent_id} AND bot_b_id = ${bot_id}))
        `;
      } else {
        matches = await sql<MatchRow[]>`
          SELECT id, tournament_id, bot_a_id, bot_b_id, score_a, score_b, rounds
          FROM matches
          WHERE tournament_id = ${tournament_id}
            AND (bot_a_id = ${bot_id} OR bot_b_id = ${bot_id})
        `;
      }

      // Return without full round data (too verbose), just summaries
      const summaries = matches.map((m) => ({
        matchId: m.id,
        botA: m.bot_a_id,
        botB: m.bot_b_id,
        scoreA: m.score_a,
        scoreB: m.score_b,
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify({ matches: summaries }) }],
      };
    },
  );

  // ==================================================================
  // RESOURCES
  // ==================================================================

  // ---- pd://docs/* — explainer markdown files ----
  const explainerDir = docsDir();
  try {
    const files = fs.readdirSync(explainerDir).filter((f) => f.endsWith('.md')).sort();
    for (const file of files) {
      const slug = file.replace(/\.md$/, '');
      const filePath = path.join(explainerDir, file);
      // Read first line for title
      const firstLine = fs.readFileSync(filePath, 'utf-8').split('\n')[0] ?? '';
      const title = firstLine.replace(/^#+\s*/, '').trim() || slug;

      mcp.resource(
        `docs-${slug}`,
        `pd://docs/${slug}`,
        { description: title, mimeType: 'text/markdown' },
        async () => ({
          contents: [{
            uri: `pd://docs/${slug}`,
            mimeType: 'text/markdown',
            text: fs.readFileSync(filePath, 'utf-8'),
          }],
        }),
      );
    }
  } catch {
    // docs directory may not exist in test environments
  }

  // ---- pd://schema/bot-spec.json ----
  mcp.resource(
    'schema-bot-spec',
    'pd://schema/bot-spec.json',
    { description: 'The authoritative JSON Schema for BotSpec', mimeType: 'application/json' },
    async () => ({
      contents: [{
        uri: 'pd://schema/bot-spec.json',
        mimeType: 'application/json',
        text: JSON.stringify(BOT_SPEC_SCHEMA, null, 2),
      }],
    }),
  );

  // ---- pd://presets/* ----
  for (const preset of PRESETS) {
    mcp.resource(
      `preset-${preset.id}`,
      `pd://presets/${preset.id}`,
      { description: `${preset.name} — ${preset.description}`, mimeType: 'application/json' },
      async () => ({
        contents: [{
          uri: `pd://presets/${preset.id}`,
          mimeType: 'application/json',
          text: JSON.stringify(preset.spec, null, 2),
        }],
      }),
    );
  }

  // ---- pd://scoring ----
  mcp.resource(
    'scoring',
    'pd://scoring',
    { description: 'Current payoff matrix constants (R, P, T, S)', mimeType: 'application/json' },
    async () => ({
      contents: [{
        uri: 'pd://scoring',
        mimeType: 'application/json',
        text: JSON.stringify(PAYOFFS, null, 2),
      }],
    }),
  );

  // ==================================================================
  // PROMPTS
  // ==================================================================

  mcp.prompt(
    'start_building_a_bot',
    'Get started building a new bot strategy for the tournament',
    async () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `I want to build a new bot for the Prisoner's Dilemma tournament. Please:

1. Fetch the following resources to understand the game and DSL:
   - pd://docs/00-what-is-this
   - pd://docs/01-prisoners-dilemma
   - pd://docs/04-writing-a-bot-dsl
   - pd://schema/bot-spec.json

2. Review a few preset examples (pd://presets/TFT, pd://presets/PAVLOV, pd://presets/GRIM) to understand the DSL patterns.

3. Then ask me what kind of strategy I'd like to build.

4. Iterate with me toward a valid BotSpec — use validate_bot_spec to check your work before submitting, and submit_bot when we're happy with it.`,
        },
      }],
    }),
  );

  mcp.prompt(
    'analyse_my_bot_performance',
    'Analyse how your bots are performing in tournaments',
    {
      player_token: z.string().optional().describe('Your player token'),
    },
    async ({ player_token }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `I want to understand how my bots are performing. Please:

1. Use list_my_bots${player_token ? ` with player_token "${player_token}"` : ''} to see my current bots.

2. Run a test tournament (run_tournament) with my bots against the classical presets to see how they fare.

3. Identify which opponents my bot performs worst against and why.

4. Suggest a revised BotSpec that addresses the weaknesses you found. Use validate_bot_spec to check it before suggesting.`,
        },
      }],
    }),
  );

  return mcp;
}
