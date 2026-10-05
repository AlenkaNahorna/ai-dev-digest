import type { z } from 'zod';
import { guarded, HintError } from '../../../application/errors.js';
import type { Log } from '../../../application/errors.js';

/** Hand-written JSON Schema subset: flat scalar properties only (keeps `tools/list` small). */
export interface ToolProperty {
  type: 'string' | 'integer';
  description: string;
  minimum?: number;
  /** Regex a string value must match (used for the digits-only PR number). */
  pattern?: string;
  enum?: string[];
}

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, ToolProperty>;
  required?: string[];
}

/** What `tools/list` publishes for a tool. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  annotations?: { readOnlyHint: true };
}

export type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

/** A registered tool: its published spec plus the call entry point. */
export interface McpTool {
  readonly spec: ToolSpec;
  call(rawArgs: unknown): Promise<ToolResult>;
}

/** Dependencies every tool factory receives from the composition root. */
export interface ToolOptions<Handler> {
  readonly log: Log;
  /** The use case wired in by `compose.ts`. Absent → the tool answers "not implemented". */
  readonly handler?: Handler;
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function formatArgIssues(error: z.ZodError): string {
  const issues = error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || 'arguments'} ${issue.message}`)
    .join('; ');
  return `Invalid arguments: ${issues}. Fix the arguments and call again.`;
}

export function notImplementedHandler(toolName: string): () => Promise<never> {
  return () =>
    Promise.reject(new HintError(`${toolName} is not implemented yet. Do not retry; continue without it.`));
}

/**
 * Builds a tool: validates arguments with `args` (invalid → `isError` result,
 * handler not called), runs `handler` under `guarded` (HintError / ApiError /
 * anything else → short safe message), and serialises success as compact JSON.
 */
export function defineTool<Args>(definition: {
  spec: ToolSpec;
  args: z.ZodType<Args, z.ZodTypeDef, unknown>;
  handler: (args: Args) => Promise<unknown>;
  log: Log;
}): McpTool {
  const { spec, args, handler, log } = definition;
  return {
    spec,
    async call(rawArgs: unknown): Promise<ToolResult> {
      const parsed = args.safeParse(rawArgs ?? {});
      if (!parsed.success) return errorResult(formatArgIssues(parsed.error));
      const outcome = await guarded(() => handler(parsed.data), log);
      if (!outcome.ok) return errorResult(outcome.message);
      const value = outcome.value;
      return textResult(typeof value === 'string' ? value : JSON.stringify(value));
    },
  };
}
