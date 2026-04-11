// @pdt/backend — Fastify server entry point.
//
// Boot sequence:
//   1. Build the Fastify app and register CORS.
//   2. Open the Postgres pool (lazy — first query opens the connection).
//   3. Run schema migrations from `apps/backend/migrations/`.
//   4. Seed the eight preset bots if they aren't already in the bots table.
//   5. Register routes (currently just /health).
//   6. Listen on 0.0.0.0:$PORT — Railway requires 0.0.0.0, not localhost,
//      so its proxy can reach the container.
//
// /health pings the database (`SELECT 1`) so a green liveness probe
// proves the whole stack — process, env vars, network path to Postgres
// — is healthy, not just that the Node process is alive.
//
// The bots and tournaments routes land in subsequent tasks.

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ENGINE_VERSION } from '@pdt/engine';
import { getDb, closeDb } from './db.js';
import { runMigrations } from './migrate.js';
import { seedPresets } from './seed.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = '0.0.0.0';

async function main(): Promise<void> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  });

  await app.register(cors, {
    // Phase 1: open CORS so a Vite dev server on localhost can hit
    // the deployed backend. We'll lock this down to the Vercel origin
    // when the frontend is hosted.
    origin: true,
  });

  // ---- DB bootstrap ----
  const sql = getDb();
  try {
    const applied = await runMigrations(sql);
    app.log.info({ applied }, 'migrations applied');
    const seeded = await seedPresets(sql);
    if (seeded.length > 0) {
      app.log.info({ seeded }, 'seeded preset bots');
    } else {
      app.log.info('preset bots already present, skipping seed');
    }
  } catch (err) {
    app.log.error({ err }, 'database bootstrap failed');
    throw err;
  }

  // ---- Routes ----
  app.get('/health', async () => {
    let dbOk = false;
    let dbError: string | undefined;
    try {
      // Cheapest possible round-trip; proves the connection is live.
      await sql`SELECT 1`;
      dbOk = true;
    } catch (err) {
      dbError = err instanceof Error ? err.message : String(err);
    }
    return {
      ok: dbOk,
      service: '@pdt/backend',
      engineVersion: ENGINE_VERSION,
      databaseUrlPresent: typeof process.env.DATABASE_URL === 'string',
      databaseOk: dbOk,
      databaseError: dbError,
      anthropicKeyPresent: typeof process.env.ANTHROPIC_API_KEY === 'string',
      uptimeSeconds: Math.round(process.uptime()),
    };
  });

  // ---- Listen ----
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`@pdt/backend listening on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // ---- Graceful shutdown ----
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received, shutting down`);
    try {
      await app.close();
      await closeDb();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
