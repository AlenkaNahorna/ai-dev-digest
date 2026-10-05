import { z } from 'zod';
import { ARG_DOC, AgentArg, PrArg, RepoArg } from './arg-schemas.js';
import { defineTool, notImplementedHandler } from './define-tool.js';
import type { McpTool, ToolOptions, ToolSpec } from './define-tool.js';

export const RUN_AGENT_ON_PR_DESCRIPTION =
  'Run one review agent on a pull request and wait for the result (up to 2 min). Returns verdict and findings. Starts a paid LLM run.';

// No annotations: this is the only tool with side effects and cost, so it must
// not be marked read-only.
const spec: ToolSpec = {
  name: 'run_agent_on_pr',
  description: RUN_AGENT_ON_PR_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      repo: { type: 'string', description: ARG_DOC.repo },
      pr: { type: 'string', pattern: '^[0-9]+$', description: ARG_DOC.pr },
      agent: { type: 'string', description: ARG_DOC.agentRequired },
    },
    required: ['repo', 'pr', 'agent'],
  },
};

const RunAgentOnPrArgs = z.object({ repo: RepoArg, pr: PrArg, agent: AgentArg });
export type RunAgentOnPrArgs = z.infer<typeof RunAgentOnPrArgs>;

/** Output: review shape, or `{run_id, status:"running", hint}` at the wait limit (plan step 6). */
export type RunAgentOnPrHandler = (args: RunAgentOnPrArgs) => Promise<unknown>;

export function createRunAgentOnPrTool(options: ToolOptions<RunAgentOnPrHandler>): McpTool {
  return defineTool({
    spec,
    args: RunAgentOnPrArgs,
    handler: options.handler ?? notImplementedHandler(spec.name),
    log: options.log,
  });
}
