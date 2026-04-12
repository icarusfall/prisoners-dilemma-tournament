// @pdt/backend — end-to-end smoke test for tournament routes.
//
// Boots a Fastify app backed by an ephemeral Postgres schema, seeds
// presets, runs both a round-robin and an evolutionary tournament via
// the API, and asserts the response shapes. The schema is dropped at
// the end so tests are fully isolated and leave no mess.
//
// Requires DATABASE_URL in the environment. Skips gracefully if it is
// not set — CI or a dev without Postgres can still run the rest of the
// suite without failure.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { runMigrations } from '../src/migrate.js';
import { seedPresets } from '../src/seed.js';
import { botsRoutes } from '../src/routes/bots.js';
import { tournamentsRoutes } from '../src/routes/tournaments.js';

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP = !DATABASE_URL;

// Unique schema name per run so parallel test processes can't collide.
const SCHEMA = `pdt_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let sql: Sql;
let app: FastifyInstance;

// Helper to issue requests against the Fastify app without listening.
function inject(method: string, url: string, payload?: unknown) {
  return app.inject({
    method: method as any,
    url,
    ...(payload !== undefined ? { payload } : {}),
  });
}

beforeAll(async () => {
  if (SKIP) return;

  // Connect with a dedicated search_path so migrations create tables
  // inside our ephemeral schema — completely isolated from production.
  const admin = postgres(DATABASE_URL!, { max: 1, ssl: 'require' });
  await admin.unsafe(`CREATE SCHEMA ${SCHEMA}`);
  await admin.end();

  sql = postgres(DATABASE_URL!, {
    max: 3,
    ssl: 'require',
    connection: { search_path: SCHEMA },
  });

  await runMigrations(sql);
  await seedPresets(sql);

  app = Fastify({ logger: false });
  await app.register(botsRoutes, { sql });
  await app.register(tournamentsRoutes, { sql });
  await app.ready();
}, 30_000);

afterAll(async () => {
  if (SKIP) return;

  await app.close();
  // Drop the ephemeral schema and all objects within it.
  const admin = postgres(DATABASE_URL!, { max: 1, ssl: 'require' });
  await admin.unsafe(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await admin.end();
  await sql.end();
}, 15_000);

// ---------------------------------------------------------------
// Round-robin
// ---------------------------------------------------------------

describe.skipIf(SKIP)('POST /api/tournaments — round-robin', () => {
  let tournamentId: string;
  let firstMatchId: string;

  it('creates a round-robin tournament', async () => {
    const res = await inject('POST', '/api/tournaments', {
      mode: 'round-robin',
      instances: [
        { botId: 'tft', count: 2 },
        { botId: 'alld', count: 2 },
        { botId: 'grim', count: 1 },
      ],
      roundsPerMatch: 200,
      seed: 42,
    });

    expect(res.statusCode).toBe(201);

    const body = res.json();
    expect(body.id).toMatch(/^tour_/);
    expect(body.mode).toBe('round-robin');
    expect(body.seed).toBe(42);
    expect(body.roundsPerMatch).toBe(200);
    expect(body.includeSelfPlay).toBe(false);
    expect(Array.isArray(body.leaderboard)).toBe(true);
    expect(body.leaderboard.length).toBeGreaterThan(0);
    expect(Array.isArray(body.matches)).toBe(true);
    expect(body.matches.length).toBeGreaterThan(0);

    // Leaderboard entries have the expected shape.
    const first = body.leaderboard[0];
    expect(first).toHaveProperty('botId');
    expect(first).toHaveProperty('instanceId');
    expect(first).toHaveProperty('totalScore');
    expect(first).toHaveProperty('rank');

    // Matches have the expected shape.
    const match = body.matches[0];
    expect(match).toHaveProperty('matchId');
    expect(match).toHaveProperty('instanceA');
    expect(match).toHaveProperty('instanceB');
    expect(match).toHaveProperty('totalA');
    expect(match).toHaveProperty('totalB');
    expect(Array.isArray(match.rounds)).toBe(true);

    tournamentId = body.id;
    firstMatchId = match.matchId;
  });

  it('retrieves the tournament by id', async () => {
    const res = await inject('GET', `/api/tournaments/${tournamentId}`);
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.id).toBe(tournamentId);
    expect(body.seed).toBe(42);
    expect(body.roundsPerMatch).toBe(200);
    expect(body.mode).toBe('round-robin');
    expect(Array.isArray(body.leaderboard)).toBe(true);
    expect(Array.isArray(body.matches)).toBe(true);
    expect(body).toHaveProperty('createdAt');
  });

  it('retrieves a single match by id', async () => {
    const res = await inject(
      'GET',
      `/api/tournaments/${tournamentId}/matches/${firstMatchId}`,
    );
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.matchId).toBe(firstMatchId);
    expect(body.tournamentId).toBe(tournamentId);
    expect(body).toHaveProperty('botAId');
    expect(body).toHaveProperty('botBId');
    expect(typeof body.scoreA).toBe('number');
    expect(typeof body.scoreB).toBe('number');
    expect(Array.isArray(body.rounds)).toBe(true);
    expect(body.rounds.length).toBe(200);
  });

  it('returns 404 for a nonexistent tournament', async () => {
    const res = await inject('GET', '/api/tournaments/tour_does_not_exist');
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
  });

  it('returns 404 for a nonexistent match', async () => {
    const res = await inject(
      'GET',
      `/api/tournaments/${tournamentId}/matches/fake_match`,
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
  });
});

// ---------------------------------------------------------------
// Evolutionary
// ---------------------------------------------------------------

describe.skipIf(SKIP)('POST /api/tournaments — evolutionary', () => {
  let tournamentId: string;

  it('creates an evolutionary tournament', async () => {
    const res = await inject('POST', '/api/tournaments', {
      mode: 'evolutionary',
      instances: [
        { botId: 'tft', count: 10 },
        { botId: 'alld', count: 10 },
        { botId: 'allc', count: 10 },
      ],
      roundsPerMatch: 150,
      generations: 50,
      seed: 7,
    });

    expect(res.statusCode).toBe(201);

    const body = res.json();
    expect(body.id).toMatch(/^tour_/);
    expect(body.mode).toBe('evolutionary');
    expect(body.seed).toBe(7);
    expect(body.roundsPerMatch).toBe(150);
    expect(typeof body.generation1Winner).toBe('string');
    expect(typeof body.dominanceWinner).toBe('string');
    expect(Array.isArray(body.extinctEver)).toBe(true);
    expect(Array.isArray(body.generations)).toBe(true);
    expect(body.generations.length).toBe(50);

    // Each generation has a leaderboard and population shares.
    const gen = body.generations[0];
    expect(Array.isArray(gen.leaderboard)).toBe(true);
    expect(gen.leaderboard[0]).toHaveProperty('botId');
    expect(gen.leaderboard[0]).toHaveProperty('totalScore');
    expect(gen.leaderboard[0]).toHaveProperty('rank');
    expect(typeof gen.population).toBe('object');
    expect(typeof gen.fitness).toBe('object');

    tournamentId = body.id;
  });

  it('retrieves the evolutionary tournament by id', async () => {
    const res = await inject('GET', `/api/tournaments/${tournamentId}`);
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.id).toBe(tournamentId);
    expect(body.seed).toBe(7);
    expect(body.roundsPerMatch).toBe(150);
    expect(typeof body.generation1Winner).toBe('string');
    expect(typeof body.dominanceWinner).toBe('string');
    expect(body).toHaveProperty('createdAt');
  });

  it('returns 404 for match lookup on an evolutionary tournament', async () => {
    const res = await inject(
      'GET',
      `/api/tournaments/${tournamentId}/matches/any`,
    );
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------
// Validation
// ---------------------------------------------------------------

describe.skipIf(SKIP)('POST /api/tournaments — validation', () => {
  it('rejects missing mode', async () => {
    const res = await inject('POST', '/api/tournaments', {
      instances: [{ botId: 'tft', count: 1 }],
      roundsPerMatch: 10,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_mode');
  });

  it('rejects empty instances', async () => {
    const res = await inject('POST', '/api/tournaments', {
      mode: 'round-robin',
      instances: [],
      roundsPerMatch: 10,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_instances');
  });

  it('rejects rounds out of range', async () => {
    const res = await inject('POST', '/api/tournaments', {
      mode: 'round-robin',
      instances: [
        { botId: 'tft', count: 1 },
        { botId: 'alld', count: 1 },
      ],
      roundsPerMatch: 99999,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_rounds');
  });

  it('rejects evolutionary without generations', async () => {
    const res = await inject('POST', '/api/tournaments', {
      mode: 'evolutionary',
      instances: [
        { botId: 'tft', count: 10 },
        { botId: 'alld', count: 10 },
      ],
      roundsPerMatch: 10,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_generations');
  });

  it('rejects unknown bot ids', async () => {
    const res = await inject('POST', '/api/tournaments', {
      mode: 'round-robin',
      instances: [
        { botId: 'tft', count: 1 },
        { botId: 'nonexistent_bot', count: 1 },
      ],
      roundsPerMatch: 10,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('unknown_bots');
  });

  it('rejects duplicate bot ids in instances', async () => {
    const res = await inject('POST', '/api/tournaments', {
      mode: 'round-robin',
      instances: [
        { botId: 'tft', count: 1 },
        { botId: 'tft', count: 1 },
      ],
      roundsPerMatch: 10,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_instances');
  });

  it('rejects invalid seed', async () => {
    const res = await inject('POST', '/api/tournaments', {
      mode: 'round-robin',
      instances: [
        { botId: 'tft', count: 1 },
        { botId: 'alld', count: 1 },
      ],
      roundsPerMatch: 10,
      seed: -1,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_seed');
  });

  it('rejects round-robin with < 2 total instances', async () => {
    const res = await inject('POST', '/api/tournaments', {
      mode: 'round-robin',
      instances: [{ botId: 'tft', count: 1 }],
      roundsPerMatch: 10,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_instances');
  });

  it('rejects evolutionary with < 2 distinct bots', async () => {
    const res = await inject('POST', '/api/tournaments', {
      mode: 'evolutionary',
      instances: [{ botId: 'tft', count: 10 }],
      roundsPerMatch: 10,
      generations: 5,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_instances');
  });
});
