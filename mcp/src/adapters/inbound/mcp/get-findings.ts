import { z } from 'zod';
import { Severity } from '@devdigest/shared';
import { AgentArg, PrArg, RepoArg } from './arg-schemas.js';
import { defineTool, notImplementedHandler } from './define-tool.js';
import type { McpTool, ToolOptions, ToolSpec } from './define-tool.js';

export const GET_FINDINGS_DESCRIPTION =
  'Read verdict and findings of reviews already run on a pull request. Does not start a review.';

const spec: ToolSpec = {
  name: 'get_findings',
  description: GET_FINDINGS_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      repo: { type: 'string', description: 'Repository as owner/name' },
      pr: { type: 'integer', minimum: 1, description: 'PR number' },
      agent: { type: 'string', description: 'Only this agent (name from list_agents)' },
      severity: { type: 'string', enum: [...Severity.options], description: 'Minimum severity' },
    },
    required: ['repo', 'pr'],
  },
  annotations: { readOnlyHint: true },
};

const GetFindingsArgs = z.object({
  repo: RepoArg,
  pr: PrArg,
  agent: AgentArg.optional(),
  severity: Severity.optional(),
});
export type GetFindingsArgs = z.infer<typeof GetFindingsArgs>;

/** Output: `{reviews:[...]}` — newest review per agent (plan step 5). */
export type GetFindingsHandler = (args: GetFindingsArgs) => Promise<unknown>;

export function createGetFindingsTool(options: ToolOptions<GetFindingsHandler>): McpTool {
  return defineTool({
    spec,
    args: GetFindingsArgs,
    handler: options.handler ?? notImplementedHandler(spec.name),
    log: options.log,
  });
}
