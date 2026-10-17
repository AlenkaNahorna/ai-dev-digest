/**
 * Application-level errors. The application layer cannot import `platform/`,
 * so it throws these and the HTTP adapter maps them onto the API taxonomy.
 * Messages are safe to return (no provider text, prompts or diffs).
 */
export type EvalErrorKind =
  | 'not_found'
  | 'finding_undecided'
  | 'finding_without_agent'
  | 'eval_case_exists'
  | 'diff_unavailable'
  | 'no_eval_cases'
  | 'batches_mismatch'
  | 'skill_not_linked';

export class EvalError extends Error {
  constructor(
    readonly kind: EvalErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'EvalError';
  }
}
