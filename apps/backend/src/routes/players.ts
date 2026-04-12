// @pdt/backend — /api/players routes.
//
// Player management for MCP auth. Each player has a unique token
// that their Claude instance passes in MCP requests. Tokens are
// generated server-side on creation.

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Sql } from 'postgres';
import { randomBytes } from 'node:crypto';
import { generateBotId } from '../util/ids.js';

interface PlayerRow {
  id: string;
  display_name: string;
  mcp_token: string;
  created_at: Date;
}

interface PlayersRouteOptions {
  sql: Sql;
}

export const playersRoutes: FastifyPluginAsync<PlayersRouteOptions> = async (
  app: FastifyInstance,
  opts: PlayersRouteOptions,
) => {
  const { sql } = opts;

  // ---------------------------------------------------------------
  // POST /api/players — create a new player
  // ---------------------------------------------------------------
  app.post<{
    Body: { display_name?: string };
  }>('/api/players', async (req, reply) => {
    const name = req.body?.display_name;
    if (typeof name !== 'string' || name.trim().length === 0) {
      return reply.code(400).send({
        error: 'invalid_body',
        message: 'display_name is required',
      });
    }
    if (name.length > 80) {
      return reply.code(400).send({
        error: 'invalid_body',
        message: 'display_name must be 80 characters or fewer',
      });
    }

    const id = generateBotId('player');
    const token = `pdt_${randomBytes(24).toString('hex')}`;

    const inserted = await sql<PlayerRow[]>`
      INSERT INTO players (id, display_name, mcp_token)
      VALUES (${id}, ${name.trim()}, ${token})
      RETURNING id, display_name, mcp_token, created_at
    `;

    return reply.code(201).send(inserted[0]);
  });

  // ---------------------------------------------------------------
  // GET /api/players — list all players (no tokens exposed)
  // ---------------------------------------------------------------
  app.get('/api/players', async () => {
    const rows = await sql<{ id: string; display_name: string; created_at: Date }[]>`
      SELECT id, display_name, created_at FROM players ORDER BY created_at DESC
    `;
    return { players: rows };
  });
};
