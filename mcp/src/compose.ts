import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createGetBlastRadiusTool } from './adapters/inbound/mcp/get-blast-radius.js';
import { createGetConventionsTool } from './adapters/inbound/mcp/get-conventions.js';
import { createGetFindingsTool } from './adapters/inbound/mcp/get-findings.js';
import { createListAgentsTool } from './adapters/inbound/mcp/list-agents.js';
import { createRunAgentOnPrTool } from './adapters/inbound/mcp/run-agent-on-pr.js';
import { createMcpServer } from './adapters/inbound/mcp/server.js';
import type { McpTool } from './adapters/inbound/mcp/define-tool.js';
import { createHttpDevDigestApi } from './adapters/outbound/http/devdigest-api.js';
import type { Log } from './application/errors.js';
import { createGetConventions } from './application/use-cases/get-conventions.js';
import { createListAgents } from './application/use-cases/list-agents.js';
import { createGetFindings } from './application/use-cases/get-findings.js';
import { createResolver } from './application/use-cases/resolve.js';
import { createRunAgentOnPr } from './application/use-cases/run-agent-on-pr.js';

/** Verbatim from the plan ("Tool descriptions" → server `instructions`). */
export const SERVER_INSTRUCTIONS = 'DevDigest PR review. Start with list_agents.';

const SERVER_NAME = 'devdigest';
const SERVER_VERSION = '0.0.0';

export interface ComposeOptions {
  /** DevDigest API base URL (`DEVDIGEST_API_URL`). */
  readonly apiUrl: string;
  /** Diagnostics sink; must write to stderr, never stdout. */
  readonly log: Log;
  /** Test seam: replaces the global `fetch` used by the HTTP adapter. */
  readonly fetch?: typeof fetch;
  /** Blocking limit of `run_agent_on_pr` in ms (`DEVDIGEST_MCP_WAIT_MS`, parsed by `index.ts`). */
  readonly waitMs?: number;
}

/**
 * Composition root: the only place that builds concrete implementations and
 * connects them. `index.ts` only adds the stdio transport; tests build the same
 * server over an in-memory transport.
 *
 * Steps 4-6: pass the use case to the tool factory below, e.g.
 *   createListAgentsTool({ log, handler: createListAgents(api) })
 * Tool definitions (name, description, schema, annotations) stay in the tool files.
 */
export function composeServer(options: ComposeOptions): Server {
  const { log } = options;
  const api = createHttpDevDigestApi({
    baseUrl: options.apiUrl,
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
  });
  // Shared by the use cases of steps 4-6 (list_agents/get_conventions use `api`
  // directly; get_findings/run_agent_on_pr use `resolver`).
  const resolver = createResolver(api);
  void resolver;

  const tools: McpTool[] = [
    createListAgentsTool({ log, handler: createListAgents(api) }),
    createRunAgentOnPrTool({
      log,
      handler: createRunAgentOnPr(api, resolver, {
        ...(options.waitMs !== undefined ? { waitMs: options.waitMs } : {}),
      }),
    }),
    createGetFindingsTool({ log, handler: createGetFindings(api, resolver) }),
    createGetConventionsTool({ log, handler: createGetConventions(api, resolver) }),
    createGetBlastRadiusTool({ log }),
  ];

  return createMcpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    instructions: SERVER_INSTRUCTIONS,
    tools,
  });
}
