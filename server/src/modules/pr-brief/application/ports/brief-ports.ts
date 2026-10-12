import type { PrBrief } from '@devdigest/shared';
import type { BoundedFacts, BriefFacts } from '../../domain/facts.js';
import type { ModelBriefOutput } from '../../domain/model-output.js';

/** Reads the precomputed facts of a PR. No LLM, no GitHub call. */
export interface BriefFactsPort {
  /** `undefined` when the pull request is not in the workspace. */
  gather(workspaceId: string, pullId: string): Promise<BriefFacts | undefined>;
}

/** Persistence of the single brief per PR. */
export interface BriefStorePort {
  /** `null` when none stored; `undefined` when the PR is not in the workspace. */
  get(workspaceId: string, pullId: string): Promise<PrBrief | null | undefined>;
  /** Replaces the stored brief in one atomic write. */
  replace(workspaceId: string, pullId: string, brief: PrBrief): Promise<void>;
}

/** The one model call. Throws `BriefError('model_failed')` on any provider failure. */
export interface BriefModelPort {
  generate(workspaceId: string, pullId: string, facts: BoundedFacts): Promise<ModelBriefOutput>;
}

/** Outcome logging without document or description text (observability NFR). */
export interface BriefLogPort {
  info(msg: string, fields: Record<string, unknown>): void;
  warn(msg: string, fields: Record<string, unknown>): void;
}
