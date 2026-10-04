import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { clipText } from '../../../domain/text.js';
import { errorResult } from './define-tool.js';
import type { McpTool } from './define-tool.js';

export interface McpServerOptions {
  readonly name: string;
  readonly version: string;
  /** One line, published in the `initialize` result. */
  readonly instructions: string;
  readonly tools: readonly McpTool[];
}

/**
 * Low-level MCP server with hand-written tool specs: the high-level
 * `McpServer.registerTool` would generate JSON Schema (and possibly `title` /
 * `outputSchema`) from Zod, which costs tokens on every client request.
 */
export function createMcpServer(options: McpServerOptions): Server {
  const byName = new Map(options.tools.map((tool) => [tool.spec.name, tool]));
  const server = new Server(
    { name: options.name, version: options.version },
    { capabilities: { tools: {} }, instructions: options.instructions },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: options.tools.map((tool) => tool.spec),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const tool = byName.get(request.params.name);
    if (tool === undefined) {
      const known = [...byName.keys()].join(', ');
      return errorResult(
        `Unknown tool '${clipText(request.params.name, 60)}'. Available tools: ${known}.`,
      );
    }
    return tool.call(request.params.arguments);
  });

  return server;
}
