// @pdt/backend — MCP HTTP handler for Fastify.
//
// Bridges between Fastify's request/response objects and the MCP SDK's
// StreamableHTTPServerTransport. We run in **stateless** mode: no
// sessions, no server-initiated notifications. The SDK's Protocol
// layer refuses a second `.connect()` on the same McpServer ("Already
// connected to a transport…"), so every request gets its OWN
// McpServer + transport pair, both closed when the response ends.
// Sharing one server across requests was the v1 implementation and
// caused every request after the first to 500.
//
// The MCP endpoint is mounted at /mcp on the Fastify server.

import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Sql } from 'postgres';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.js';

interface McpHandlerOptions {
  sql: Sql;
}

export const mcpHandler: FastifyPluginAsync<McpHandlerOptions> = async (
  app: FastifyInstance,
  opts: McpHandlerOptions,
) => {
  async function handle(req: FastifyRequest, reply: FastifyReply, body?: unknown): Promise<void> {
    const mcpServer = createMcpServer(opts.sql);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });

    // When the client disconnects (or the response finishes) tear
    // down both ends so we don't leak server instances.
    const cleanup = (): void => {
      void transport.close();
      void mcpServer.close();
    };
    reply.raw.on('close', cleanup);

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, body);
    } catch (err) {
      app.log.error({ err }, 'MCP handler failed');
      cleanup();
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500;
        reply.raw.setHeader('content-type', 'application/json');
        reply.raw.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
          id: null,
        }));
      }
    }

    // Mark as sent so Fastify doesn't try to send another response.
    reply.hijack();
  }

  // POST /mcp — the primary MCP endpoint for Streamable HTTP.
  app.post('/mcp', async (req, reply) => {
    await handle(req, reply, req.body);
  });

  // GET /mcp — SSE endpoint. In stateless mode the SDK returns 405
  // here itself, but we still need a fresh server per call.
  app.get('/mcp', async (req, reply) => {
    await handle(req, reply);
  });

  // DELETE /mcp — session termination (no-op in stateless mode).
  app.delete('/mcp', async (_req, reply) => {
    reply.code(405).send({ error: 'method_not_allowed', message: 'Session termination not supported in stateless mode' });
  });
};
