import { z } from 'zod';
import { parseRepoRef } from '../../../domain/input.js';

/** Zod argument schemas shared by several tools (the single source for arg types). */

/** Param docs with examples: the same text goes into `tools/list` and into `.describe()`. */
export const ARG_DOC = {
  repo: 'Repository as owner/name, e.g. "acme/payments"',
  pr: 'PR number as a string, e.g. "42"',
  agentRequired: 'Agent id or name from list_agents, e.g. "security"',
  agentOptional: 'Only this agent (id or name from list_agents), e.g. "security"',
  severity: 'Minimum severity, e.g. "WARNING"',
  category: 'Only this category, e.g. "naming"',
} as const;

export const RepoArg = z
  .string()
  .refine((value) => parseRepoRef(value) !== null, { message: 'must look like owner/name' })
  .describe(ARG_DOC.repo);

/** Digits-only strings are what the tool advertises; a plain number is tolerated for clients that send one. */
const toNumber = (value: unknown): unknown =>
  typeof value === 'string' && /^[0-9]+$/.test(value.trim()) ? Number(value.trim()) : value;

export const PrArg = z
  .preprocess(
    toNumber,
    z
      .number({ invalid_type_error: 'must be a positive integer', required_error: 'is required' })
      .int({ message: 'must be a positive integer' })
      .positive({ message: 'must be a positive integer' })
      .safe({ message: 'must be a positive integer' }),
  )
  .describe(ARG_DOC.pr);

export const AgentArg = z
  .string()
  .trim()
  .min(1, { message: 'must not be empty' })
  .max(200, { message: 'is too long' })
  .describe(ARG_DOC.agentRequired);
