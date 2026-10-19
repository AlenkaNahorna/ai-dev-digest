import type { CiVerdict, GitHubReviewPayload } from '@devdigest/shared';

/**
 * Map reviewer-core's deterministic GitHub review event
 * (`GitHubReviewPayload['event']`) to the persisted `CiVerdict`. Pure, total.
 * The event itself is derived from grounded findings + `ci_fail_on` by
 * `toReviewPayload` — this is a lower-casing rename, never the model self-report
 * (AC-10). Kept in the server domain so ingest + CI-Runs read agree on the enum.
 */
export function eventToVerdict(event: GitHubReviewPayload['event']): CiVerdict {
  switch (event) {
    case 'APPROVE':
      return 'approve';
    case 'REQUEST_CHANGES':
      return 'request_changes';
    case 'COMMENT':
      return 'comment';
  }
}
