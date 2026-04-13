// REST endpoints for live arena decisions (Phase 7 — C3).
//
// The frontend arena creates pending decisions when a live bot collides,
// then polls for responses. MCP clients use the MCP tools instead.
//
// POST /api/arena/pending   — create a pending decision
// GET  /api/arena/pending   — list all pending decisions
// GET  /api/arena/decision/:id — poll for a decision result
// DELETE /api/arena/pending  — clear all (for arena restart)

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  createPendingDecision,
  getDecision,
  listPending,
  clearAll,
  DECISION_TIMEOUT_MS,
  type PendingDecision,
} from '../arena/pending-decisions.js';

export const arenaLiveRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ---- POST /api/arena/pending — frontend creates a pending decision ----
  app.post('/api/arena/pending', async (req, reply) => {
    const body = req.body as {
      id: string;
      botInstanceId: string;
      botId: string;
      botName: string;
      opponentInstanceId: string;
      opponentName: string;
      round: number;
      myMoves: string[];
      theirMoves: string[];
    };

    if (!body.id || !body.botInstanceId) {
      return reply.code(400).send({ error: 'missing_fields' });
    }

    const decision = createPendingDecision({
      id: body.id,
      botInstanceId: body.botInstanceId,
      botId: body.botId,
      botName: body.botName,
      opponentInstanceId: body.opponentInstanceId,
      opponentName: body.opponentName,
      round: body.round,
      myMoves: (body.myMoves ?? []) as PendingDecision['myMoves'],
      theirMoves: (body.theirMoves ?? []) as PendingDecision['theirMoves'],
    });

    return reply.code(201).send({
      id: decision.id,
      timeoutMs: DECISION_TIMEOUT_MS,
    });
  });

  // ---- GET /api/arena/pending — list all pending decisions ----
  app.get('/api/arena/pending', async () => {
    return { decisions: listPending() };
  });

  // ---- GET /api/arena/decision/:id — poll for result ----
  app.get<{ Params: { id: string } }>('/api/arena/decision/:id', async (req, reply) => {
    const d = getDecision(req.params.id);
    if (!d) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return {
      id: d.id,
      botInstanceId: d.botInstanceId,
      move: d.move,
      resolved: d.move !== null,
      expired: !d.move && Date.now() - d.createdAt > DECISION_TIMEOUT_MS,
    };
  });

  // ---- DELETE /api/arena/pending — clear all (arena restart) ----
  app.delete('/api/arena/pending', async () => {
    clearAll();
    return { ok: true };
  });
};
