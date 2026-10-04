import { z } from 'zod';
import { ConventionCategory } from '@devdigest/shared';
import { RepoArg } from './arg-schemas.js';
import { defineTool, notImplementedHandler } from './define-tool.js';
import type { McpTool, ToolOptions, ToolSpec } from './define-tool.js';

export const GET_CONVENTIONS_DESCRIPTION =
  'Get the house rules extracted from a repository (latest scan). Use before writing or reviewing code there.';

const spec: ToolSpec = {
  name: 'get_conventions',
  description: GET_CONVENTIONS_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      repo: { type: 'string', description: 'Repository as owner/name' },
      category: {
        type: 'string',
        enum: [...ConventionCategory.options],
        description: 'Only this category',
      },
    },
    required: ['repo'],
  },
  annotations: { readOnlyHint: true },
};

const GetConventionsArgs = z.object({
  repo: RepoArg,
  category: ConventionCategory.optional(),
});
export type GetConventionsArgs = z.infer<typeof GetConventionsArgs>;

/** Output: `{scanned_at, conventions:[...]}` (plan step 4). */
export type GetConventionsHandler = (args: GetConventionsArgs) => Promise<unknown>;

export function createGetConventionsTool(options: ToolOptions<GetConventionsHandler>): McpTool {
  return defineTool({
    spec,
    args: GetConventionsArgs,
    handler: options.handler ?? notImplementedHandler(spec.name),
    log: options.log,
  });
}
