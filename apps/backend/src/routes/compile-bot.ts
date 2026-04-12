// @pdt/backend — POST /api/compile-bot route.
//
// Accepts a natural-language strategy description and returns a
// compiled BotSpec. The heavy lifting is in `compiler/compile-bot.ts`;
// this file is just the Fastify glue.

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { compileBot } from '../compiler/compile-bot.js';

export const compileBotRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post<{
    Body: { description?: string };
  }>('/api/compile-bot', async (req, reply) => {
    const description = req.body?.description;

    if (typeof description !== 'string' || description.trim().length === 0) {
      return reply.code(400).send({
        error: 'invalid_body',
        message: 'description is required and must be a non-empty string',
      });
    }

    if (description.length > 5000) {
      return reply.code(400).send({
        error: 'invalid_body',
        message: 'description must be 5000 characters or fewer',
      });
    }

    // Check that the API key is configured
    if (!process.env.ANTHROPIC_API_KEY) {
      return reply.code(503).send({
        error: 'service_unavailable',
        message: 'Natural-language compilation is not available (API key not configured)',
      });
    }

    const result = await compileBot(description.trim());

    if (result.ok) {
      return { spec: result.spec };
    }

    return reply.code(422).send({
      error: 'compilation_failed',
      message: result.error,
      details: result.details,
    });
  });
};
