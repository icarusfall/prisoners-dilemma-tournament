// @pdt/backend — MCP HTTP handler for Fastify.
//
// Bridges between Fastify's request/response objects and the MCP SDK's
// StreamableHTTPServerTransport. Each request gets its own transport
// instance (stateless mode) since we don't need server-initiated
// notifications for v1.
//
// The MCP endpoint is mounted at /mcp on the Fastify server.

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Sql } from 'postgres';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.js';

interface McpHandlerOptions {
  sql: Sql;
}

export const mcpHandler: FastifyPluginAsync<McpHandlerOptions> = async (
  app: FastifyInstance,
  opts: McpHandlerOptions,
) => {
  const mcpServer = createMcpServer(opts.sql);

  // Handle POST /mcp — the primary MCP endpoint for Streamable HTTP
  app.post('/mcp', async (req, reply) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });

    // Connect the MCP server to this transport
    await mcpServer.connect(transport);

    // Bridge Fastify raw request/response to the transport
    await transport.handleRequest(req.raw, reply.raw, req.body);

    // Mark as sent so Fastify doesn't try to send another response
    reply.hijack();
  });

  // Handle GET /mcp — SSE endpoint for server-initiated messages
  app.get('/mcp', async (req, reply) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await mcpServer.connect(transport);
    await transport.handleRequest(req.raw, reply.raw);

    reply.hijack();
  });

  // Handle DELETE /mcp — session termination (no-op in stateless mode)
  app.delete('/mcp', async (_req, reply) => {
    reply.code(405).send({ error: 'method_not_allowed', message: 'Session termination not supported in stateless mode' });
  });
};
