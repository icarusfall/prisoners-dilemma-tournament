// @pdt/backend — Fastify server entry point.
//
// Phase 1 task 9 (skeleton). Currently exposes:
//   GET /health  → liveness probe used by Railway and the smoke test
//
// Postgres connection, schema migration, and the bots/tournaments
// routes land in subsequent tasks. The DATABASE_URL env var is read
// here only for diagnostics in /health (so we can confirm Railway
// injected it without leaking the value).
//
// Listens on 0.0.0.0:$PORT — Railway requires binding to 0.0.0.0,
// not localhost, so its proxy can reach the container.

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ENGINE_VERSION } from '@pdt/engine';

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

  app.get('/health', async () => {
    return {
      ok: true,
      service: '@pdt/backend',
      engineVersion: ENGINE_VERSION,
      databaseUrlPresent: typeof process.env.DATABASE_URL === 'string',
      anthropicKeyPresent: typeof process.env.ANTHROPIC_API_KEY === 'string',
      uptimeSeconds: Math.round(process.uptime()),
    };
  });

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`@pdt/backend listening on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
