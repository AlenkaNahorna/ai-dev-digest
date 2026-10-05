import { z } from 'zod';
import { defineTool, notImplementedHandler } from './define-tool.js';
import type { McpTool, ToolOptions, ToolSpec } from './define-tool.js';

export const LIST_AGENTS_DESCRIPTION =
  'List the review agents configured in DevDigest. Call first to get a valid agent name.';

const spec: ToolSpec = {
  name: 'list_agents',
  description: LIST_AGENTS_DESCRIPTION,
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true },
};

const ListAgentsArgs = z.object({});
export type ListAgentsArgs = z.infer<typeof ListAgentsArgs>;

/** Output: `{agents:[{id, name, description, model, enabled}]}` (plan step 4, amended 2026-10-05). */
export type ListAgentsHandler = (args: ListAgentsArgs) => Promise<unknown>;

export function createListAgentsTool(options: ToolOptions<ListAgentsHandler>): McpTool {
  return defineTool({
    spec,
    args: ListAgentsArgs,
    handler: options.handler ?? notImplementedHandler(spec.name),
    log: options.log,
  });
}
