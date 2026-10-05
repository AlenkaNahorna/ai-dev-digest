import { z } from 'zod';
import { ARG_DOC, PrArg, RepoArg } from './arg-schemas.js';
import { defineTool, notImplementedHandler } from './define-tool.js';
import type { McpTool, ToolOptions, ToolSpec } from './define-tool.js';

export const GET_BLAST_RADIUS_DESCRIPTION =
  'Show which symbols, callers and endpoints a pull request affects. Read-only, from the repo index; may be partial.';

const spec: ToolSpec = {
  name: 'get_blast_radius',
  description: GET_BLAST_RADIUS_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      repo: { type: 'string', description: ARG_DOC.repo },
      pr: { type: 'string', pattern: '^[0-9]+$', description: ARG_DOC.pr },
    },
    required: ['repo', 'pr'],
  },
  annotations: { readOnlyHint: true },
};

const GetBlastRadiusArgs = z.object({ repo: RepoArg, pr: PrArg });
export type GetBlastRadiusArgs = z.infer<typeof GetBlastRadiusArgs>;

/** Output: `{summary, changed_symbols, downstream, more?, prior_prs?, degraded?, degraded_reason?, hint?}`. */
export type GetBlastRadiusHandler = (args: GetBlastRadiusArgs) => Promise<unknown>;

export function createGetBlastRadiusTool(options: ToolOptions<GetBlastRadiusHandler>): McpTool {
  return defineTool({
    spec,
    args: GetBlastRadiusArgs,
    handler: options.handler ?? notImplementedHandler(spec.name),
    log: options.log,
  });
}
