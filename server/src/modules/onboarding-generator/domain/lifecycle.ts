import type { GenerationErrorCategory } from '@devdigest/shared/contracts/onboarding-generator.js';

/**
 * Generation request lifecycle (durable, DB-backed):
 *
 *   queued ──claim──▶ running ──▶ succeeded
 *      │                 │  └────▶ failed
 *      └──────┬──────────┘
 *             └─ a newer request for the repo ──▶ superseded
 *
 * Worker writes are fenced by (request id, attempt token, lease): a superseded,
 * timed-out or previous-process completion can never publish.
 */
export type RequestStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'superseded';
export type RequestTrigger = 'automatic' | 'manual';

/** Active = still able to produce a result. */
export function isActiveStatus(s: RequestStatus): boolean {
  return s === 'queued' || s === 'running';
}

export interface IndexIdentity {
  sourceSha: string;
  indexerVersion: number;
  indexStatus: 'full' | 'partial';
}

/**
 * Automatic generation is de-duplicated per index identity: the same commit,
 * indexer version and completeness never schedules a second automatic request
 * (a no-op refresh bumps timestamps but not the identity).
 */
export function automaticIdentityKey(i: IndexIdentity): string {
  return `${i.sourceSha}:${i.indexerVersion}:${i.indexStatus}`;
}

/** Manual requests are never deduplicated; the key just records the identity at request time. */
export function manualIdentityKey(i: IndexIdentity, nonce: string): string {
  return `${automaticIdentityKey(i)}:manual:${nonce}`;
}

/** Thrown inside generation to carry a SAFE category (never raw provider text). */
export class GenerationFailure extends Error {
  constructor(
    readonly category: GenerationErrorCategory,
    /** Internal detail for redacted logs only; never stored or returned. */
    readonly detail?: string,
  ) {
    super(category);
    this.name = 'GenerationFailure';
  }
}

/** User-facing explanations per category. No provider text, prompts, paths or stacks. */
export const SAFE_ERROR_MESSAGES: Record<GenerationErrorCategory, string> = {
  configuration:
    'The tour could not be generated because no model is configured. Check the Onboarding Tour model and its API key in Settings, then retry.',
  evidence_unavailable:
    'The tour could not be generated because the repository index has no usable evidence. Re-index the repository, then retry.',
  invalid_output:
    'The model returned a tour that could not be validated against the repository. Retry generation; the previous tour is unchanged.',
  timeout: 'Generation took too long and was stopped. Retry; the previous tour is unchanged.',
  provider_failure: 'The model provider returned an error. Retry in a moment; the previous tour is unchanged.',
  internal: 'Generation failed unexpectedly. Retry; the previous tour is unchanged.',
};

export const BUDGET_REACHED_MESSAGE =
  'The daily generation limit for this repository was reached. Automatic and manual generation resume when the 24-hour window moves on.';
