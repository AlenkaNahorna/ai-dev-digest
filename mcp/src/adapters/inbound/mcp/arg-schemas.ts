import { z } from 'zod';
import { parseRepoRef } from '../../../domain/input.js';

/** Zod argument schemas shared by several tools (the single source for arg types). */

export const RepoArg = z
  .string()
  .refine((value) => parseRepoRef(value) !== null, { message: 'must look like owner/name' });

export const PrArg = z
  .number({ invalid_type_error: 'must be a positive integer', required_error: 'is required' })
  .int({ message: 'must be a positive integer' })
  .positive({ message: 'must be a positive integer' })
  .safe({ message: 'must be a positive integer' });

export const AgentArg = z
  .string()
  .trim()
  .min(1, { message: 'must not be empty' })
  .max(200, { message: 'is too long' });
