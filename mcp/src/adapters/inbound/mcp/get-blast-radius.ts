import { z } from 'zod';
import { PrArg, RepoArg } from './arg-schemas.js';
import { defineTool } from './define-tool.js';
import type { McpTool, ToolOptions, ToolSpec } from './define-tool.js';
import { HintError } from '../../../application/errors.js';

export const GET_BLAST_RADIUS_DESCRIPTION =
  'Show which symbols, callers and endpoints a pull request affects. Not implemented yet.';

/** Verbatim stub text from the plan. */
export const GET_BLAST_RADIUS_STUB_TEXT =
  'get_blast_radius is not implemented yet. Do not retry; continue without it.';

const spec: ToolSpec = {
  name: 'get_blast_radius',
  description: GET_BLAST_RADIUS_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      repo: { type: 'string', description: 'Repository as owner/name' },
      pr: { type: 'integer', minimum: 1, description: 'PR number' },
    },
    required: ['repo', 'pr'],
  },
  annotations: { readOnlyHint: true },
};

const GetBlastRadiusArgs = z.object({ repo: RepoArg, pr: PrArg });
export type GetBlastRadiusArgs = z.infer<typeof GetBlastRadiusArgs>;

/**
 * Visible stub (owner decision): input is validated, then the fixed stub text
 * is returned as an error result. Plan step 9 replaces the handler later; the
 * input schema does not change.
 */
const stubHandler = (): Promise<never> =>
  Promise.reject(new HintError(GET_BLAST_RADIUS_STUB_TEXT));

export function createGetBlastRadiusTool(options: Pick<ToolOptions<never>, 'log'>): McpTool {
  return defineTool({ spec, args: GetBlastRadiusArgs, handler: stubHandler, log: options.log });
}
