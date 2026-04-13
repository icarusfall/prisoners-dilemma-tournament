// @pdt/backend — /api/tournaments routes.
//
// Three endpoints, all defined in architecture.md §14 task 11:
//
//   POST /api/tournaments
//     { instances: { botId, count }[], roundsPerMatch,
//       mode: 'round-robin' | 'evolutionary', generations?, seed?, name? }
//     Runs the tournament *synchronously* in-process via the engine
//     and persists tournaments / tournament_entries / matches rows
//     inside a single transaction. Returns the assigned id plus the
//     full TournamentResult or EvolutionaryResult.
//
//   GET /api/tournaments/:id
//     Returns the persisted result JSONB merged with the row metadata.
//
//   GET /api/tournaments/:id/matches/:matchId
//     Returns one match's full round-by-round log. Round-robin only —
//     evolutionary mode doesn't surface per-pair MatchResults from the
//     engine, so this 404s for evolutionary tournaments.
//
// Block test coverage is intentionally deferred to Phase 1 task 15
// (end-to-end smoke test against an ephemeral Postgres). Validator-
// style unit tests would mostly exercise the postgres driver.

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Sql } from 'postgres';
import {
  compile,
  runTournament,
  runEvolutionaryTournament,
  type BotInstance,
  type BotSpec,
  type EvolutionaryEntry,
  type EvolutionaryResult,
  type MatchResult,
  type RoundResult,
  type TournamentResult,
  GAME_TYPES,
  type GameType,
} from '@pdt/engine';
import { generateBotId } from '../util/ids.js';

interface TournamentsRouteOptions {
  sql: Sql;
}

interface BotRow {
  id: string;
  name: string;
  spec: BotSpec;
}

interface InstanceSpecInput {
  botId: string;
  count: number;
}

interface PostBody {
  name?: string;
  instances?: InstanceSpecInput[];
  roundsPerMatch?: number;
  mode?: string;
  generations?: number;
  seed?: number;
  noisyEnding?: boolean;
  gameType?: string;
}

interface ValidatedBody {
  name: string | null;
  instances: InstanceSpecInput[];
  roundsPerMatch: number;
  mode: 'round-robin' | 'evolutionary';
  generations: number | undefined;
  seed: number;
  noisyEnding: boolean;
  gameType: GameType;
}

// Sane Phase-1 bounds. The engine is fast — these caps mostly exist so
// a malformed request can't accidentally spin a Railway hobby instance
// for minutes. Bump later if a real workload needs it.
const ROUNDS_MIN = 1;
const ROUNDS_MAX = 10_000;
const COUNT_MIN = 1;
const COUNT_MAX = 50;
const GENERATIONS_MIN = 1;
const GENERATIONS_MAX = 1000;

// Default seed when the caller doesn't supply one. We stay inside the
// 32-bit unsigned range so the engine's bit-mixing helpers (which use
// `>>> 0`) behave the same as for an explicit seed, and we round to an
// integer so the value round-trips through the BIGINT column cleanly.
function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

type ValidationError = {
  ok: false;
  status: number;
  error: string;
  message: string;
};

type ValidationOk = { ok: true; value: ValidatedBody };

function validatePostBody(body: PostBody): ValidationOk | ValidationError {
  if (body === null || typeof body !== 'object') {
    return {
      ok: false,
      status: 400,
      error: 'invalid_body',
      message: 'request body must be a JSON object',
    };
  }

  const { instances, roundsPerMatch, mode, generations, seed, name, noisyEnding, gameType } = body;

  if (mode !== 'round-robin' && mode !== 'evolutionary') {
    return {
      ok: false,
      status: 400,
      error: 'invalid_mode',
      message: `mode must be 'round-robin' or 'evolutionary'`,
    };
  }

  if (!Array.isArray(instances) || instances.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_instances',
      message: 'instances must be a non-empty array',
    };
  }

  const seenBotIds = new Set<string>();
  for (const inst of instances) {
    if (
      inst === null ||
      typeof inst !== 'object' ||
      typeof inst.botId !== 'string' ||
      typeof inst.count !== 'number'
    ) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_instances',
        message: 'each instance must be { botId: string, count: number }',
      };
    }
    if (
      !Number.isInteger(inst.count) ||
      inst.count < COUNT_MIN ||
      inst.count > COUNT_MAX
    ) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_instances',
        message: `instance count must be an integer in [${COUNT_MIN}, ${COUNT_MAX}]`,
      };
    }
    if (seenBotIds.has(inst.botId)) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_instances',
        message: `duplicate botId "${inst.botId}" — combine into one entry with a higher count`,
      };
    }
    seenBotIds.add(inst.botId);
  }

  if (
    typeof roundsPerMatch !== 'number' ||
    !Number.isInteger(roundsPerMatch) ||
    roundsPerMatch < ROUNDS_MIN ||
    roundsPerMatch > ROUNDS_MAX
  ) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_rounds',
      message: `roundsPerMatch must be an integer in [${ROUNDS_MIN}, ${ROUNDS_MAX}]`,
    };
  }

  let validatedGenerations: number | undefined;
  if (mode === 'evolutionary') {
    if (
      typeof generations !== 'number' ||
      !Number.isInteger(generations) ||
      generations < GENERATIONS_MIN ||
      generations > GENERATIONS_MAX
    ) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_generations',
        message: `evolutionary mode requires generations as an integer in [${GENERATIONS_MIN}, ${GENERATIONS_MAX}]`,
      };
    }
    validatedGenerations = generations;
    // Evolutionary mode is keyed by distinct strategies; the `count`
    // becomes a starting population weight rather than a copy count.
    if (instances.length < 2) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_instances',
        message: 'evolutionary mode needs at least 2 distinct bots',
      };
    }
  } else {
    // Round-robin: total *instances* must be >= 2 so the engine has at
    // least one pair to play.
    const totalInstances = instances.reduce((s, i) => s + i.count, 0);
    if (totalInstances < 2) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_instances',
        message: 'round-robin mode needs at least 2 total instances across all entries',
      };
    }
  }

  let validatedSeed: number;
  if (seed === undefined) {
    validatedSeed = randomSeed();
  } else if (
    typeof seed !== 'number' ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0x7fffffff
  ) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_seed',
      message: 'seed must be a non-negative 32-bit integer',
    };
  } else {
    validatedSeed = seed;
  }

  let validatedName: string | null = null;
  if (name !== undefined) {
    if (typeof name !== 'string') {
      return {
        ok: false,
        status: 400,
        error: 'invalid_name',
        message: 'name must be a string',
      };
    }
    const trimmed = name.trim();
    if (trimmed.length > 0) validatedName = trimmed;
  }

  const validGameTypes = Object.keys(GAME_TYPES);
  const validatedGameType: GameType = (gameType && validGameTypes.includes(gameType))
    ? gameType as GameType
    : 'prisoners-dilemma';

  return {
    ok: true,
    value: {
      name: validatedName,
      instances,
      roundsPerMatch,
      mode,
      generations: validatedGenerations,
      seed: validatedSeed,
      noisyEnding: !!noisyEnding,
      gameType: validatedGameType,
    },
  };
}

export const tournamentsRoutes: FastifyPluginAsync<TournamentsRouteOptions> = async (
  app: FastifyInstance,
  opts: TournamentsRouteOptions,
) => {
  const { sql } = opts;

  // ---------------------------------------------------------------
  // POST /api/tournaments
  // ---------------------------------------------------------------
  app.post<{ Body: PostBody }>('/api/tournaments', async (req, reply) => {
    const validated = validatePostBody(req.body ?? {});
    if (!validated.ok) {
      return reply
        .code(validated.status)
        .send({ error: validated.error, message: validated.message });
    }
    const body = validated.value;

    // Load all referenced bot rows in a single query.
    const botIds = body.instances.map((i) => i.botId);
    const rows = await sql<BotRow[]>`
      SELECT id, name, spec FROM bots WHERE id IN ${sql(botIds)}
    `;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const missing = botIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      return reply.code(400).send({
        error: 'unknown_bots',
        message: `unknown botId(s): ${missing.join(', ')}`,
      });
    }

    const tournamentId = generateBotId('tour');

    if (body.mode === 'round-robin') {
      // Build a flat BotInstance[] with unique instanceIds. We compile
      // each spec exactly once even if a bot has count > 1 — the
      // returned DecisionFn is pure given a BotView, so it's safe to
      // share across instances.
      const instances: BotInstance[] = [];
      for (const entry of body.instances) {
        const row = byId.get(entry.botId)!;
        const decide = compile(row.spec);
        for (let idx = 0; idx < entry.count; idx++) {
          instances.push({
            instanceId: `${entry.botId}#${idx}`,
            botId: entry.botId,
            spec: row.spec,
            decide,
          });
        }
      }

      let result: TournamentResult;
      try {
        result = runTournament(instances, body.roundsPerMatch, body.seed, {
          noisyEnding: body.noisyEnding,
          gameType: body.gameType,
        });
      } catch (err) {
        return reply.code(400).send({
          error: 'engine_error',
          message: err instanceof Error ? err.message : String(err),
        });
      }

      // The engine leaderboard is per-instance; the persistent
      // tournament_entries table is keyed by botId so we aggregate.
      // Multiple TFT instances all roll up into one TFT row with the
      // sum of their scores.
      const totals = new Map<string, number>();
      for (const lbRow of result.leaderboard) {
        totals.set(lbRow.botId, (totals.get(lbRow.botId) ?? 0) + lbRow.totalScore);
      }
      const ranked = rankByScore(totals);

      await persistTournament(sql, {
        tournamentId,
        name: body.name,
        mode: 'round-robin',
        seed: body.seed,
        roundsPerMatch: body.roundsPerMatch,
        result,
        ranked,
        matches: result.matches,
      });

      return reply.code(201).send({ id: tournamentId, ...result });
    }

    // ----- Evolutionary mode -----
    const entries: EvolutionaryEntry[] = body.instances.map((entry) => {
      const row = byId.get(entry.botId)!;
      return {
        botId: entry.botId,
        spec: row.spec,
        initialShare: entry.count,
      };
    });

    let result: EvolutionaryResult;
    try {
      result = runEvolutionaryTournament(
        entries,
        body.roundsPerMatch,
        body.generations!,
        body.seed,
        { noisyEnding: body.noisyEnding, gameType: body.gameType },
      );
    } catch (err) {
      return reply.code(400).send({
        error: 'engine_error',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // Use the gen-0 (Axelrod-faithful) leaderboard for tournament_entries.
    // The engine already tags this as `generation1Winner` and ranks it
    // with the same standard-competition rule as round-robin.
    const gen0 = result.generations[0]!.leaderboard;
    const ranked = gen0.map((lbRow) => ({
      botId: lbRow.botId,
      totalScore: Math.round(lbRow.totalScore),
      rank: lbRow.rank,
    }));

    await persistTournament(sql, {
      tournamentId,
      name: body.name,
      mode: 'evolutionary',
      seed: body.seed,
      roundsPerMatch: body.roundsPerMatch,
      result,
      ranked,
      matches: [],
    });

    return reply.code(201).send({ id: tournamentId, ...result });
  });

  // ---------------------------------------------------------------
  // GET /api/tournaments/:id
  // ---------------------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/tournaments/:id', async (req, reply) => {
    const { id } = req.params;
    const rows = await sql<
      {
        id: string;
        name: string | null;
        mode: string;
        rounds_per_match: number;
        seed: string;
        result: TournamentResult | EvolutionaryResult;
        created_at: Date;
      }[]
    >`
      SELECT id, name, mode, rounds_per_match, seed, result, created_at
      FROM tournaments
      WHERE id = ${id}
    `;
    if (rows.length === 0) {
      return reply
        .code(404)
        .send({ error: 'not_found', message: `no tournament with id ${id}` });
    }
    const row = rows[0]!;
    // Spread the engine result on top so consumers see one flat object
    // identical in shape to the POST response. The BIGINT seed comes
    // back as a string from the postgres driver, so coerce it.
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      ...row.result,
      seed: Number(row.seed),
      roundsPerMatch: row.rounds_per_match,
    };
  });

  // ---------------------------------------------------------------
  // GET /api/tournaments/:id/matches/:matchId
  // ---------------------------------------------------------------
  app.get<{ Params: { id: string; matchId: string } }>(
    '/api/tournaments/:id/matches/:matchId',
    async (req, reply) => {
      const { id, matchId } = req.params;
      // Stored ids are `${tournamentId}:${engineMatchId}` so engine
      // match ids stay collision-free across tournaments.
      const dbId = `${id}:${matchId}`;
      const rows = await sql<
        {
          id: string;
          tournament_id: string;
          bot_a_id: string;
          bot_b_id: string;
          score_a: number;
          score_b: number;
          rounds: RoundResult[];
        }[]
      >`
        SELECT id, tournament_id, bot_a_id, bot_b_id, score_a, score_b, rounds
        FROM matches
        WHERE id = ${dbId}
      `;
      if (rows.length === 0) {
        return reply.code(404).send({
          error: 'not_found',
          message: `no match ${matchId} in tournament ${id}`,
        });
      }
      const row = rows[0]!;
      return {
        matchId,
        tournamentId: row.tournament_id,
        botAId: row.bot_a_id,
        botBId: row.bot_b_id,
        scoreA: row.score_a,
        scoreB: row.score_b,
        rounds: row.rounds,
      };
    },
  );
};

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

interface PersistArgs {
  tournamentId: string;
  name: string | null;
  mode: 'round-robin' | 'evolutionary';
  seed: number;
  roundsPerMatch: number;
  result: TournamentResult | EvolutionaryResult;
  ranked: { botId: string; totalScore: number; rank: number }[];
  matches: MatchResult[];
}

async function persistTournament(sql: Sql, args: PersistArgs): Promise<void> {
  const { tournamentId, name, mode, seed, roundsPerMatch, result, ranked, matches } =
    args;

  // One transaction so a partial failure can't leave a tournaments row
  // without its entries / matches.
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO tournaments (id, name, mode, rounds_per_match, seed, result)
      VALUES (
        ${tournamentId},
        ${name},
        ${mode},
        ${roundsPerMatch},
        ${seed},
        ${sql.json(result as unknown as Parameters<typeof sql.json>[0])}
      )
    `;

    for (const entry of ranked) {
      await tx`
        INSERT INTO tournament_entries (tournament_id, bot_id, total_score, rank)
        VALUES (${tournamentId}, ${entry.botId}, ${entry.totalScore}, ${entry.rank})
      `;
    }

    for (const m of matches) {
      const dbId = `${tournamentId}:${m.matchId}`;
      const botAId = instanceIdToBotId(m.instanceA);
      const botBId = instanceIdToBotId(m.instanceB);
      await tx`
        INSERT INTO matches (id, tournament_id, bot_a_id, bot_b_id, score_a, score_b, rounds)
        VALUES (
          ${dbId},
          ${tournamentId},
          ${botAId},
          ${botBId},
          ${m.totalA},
          ${m.totalB},
          ${sql.json(m.rounds as unknown as Parameters<typeof sql.json>[0])}
        )
      `;
    }
  });
}

/**
 * Standard competition ranking (1-2-2-4) over a botId → score map.
 * Sort is by score desc, ties broken by botId for determinism.
 */
function rankByScore(
  totals: Map<string, number>,
): { botId: string; totalScore: number; rank: number }[] {
  const sorted = Array.from(totals.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  const out: { botId: string; totalScore: number; rank: number }[] = [];
  let lastScore: number | null = null;
  let lastRank = 0;
  sorted.forEach(([botId, totalScore], idx) => {
    let rank: number;
    if (lastScore === null || totalScore !== lastScore) {
      rank = idx + 1;
      lastRank = rank;
      lastScore = totalScore;
    } else {
      rank = lastRank;
    }
    out.push({ botId, totalScore, rank });
  });
  return out;
}

/**
 * Map an engine instanceId (`${botId}#${idx}`) back to its botId. The
 * matches table FK references the persistent bot id, not the per-run
 * instance id.
 */
function instanceIdToBotId(instanceId: string): string {
  const hashIdx = instanceId.indexOf('#');
  return hashIdx >= 0 ? instanceId.slice(0, hashIdx) : instanceId;
}
