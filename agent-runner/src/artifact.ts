import type { CiVerdict, Finding, GitHubReviewPayload } from '@devdigest/shared';
import { CiResultArtifact } from '@devdigest/shared';
import { RunnerError } from './errors.js';

/** Runner version string embedded in every artifact (informational only). */
export const RUNNER_VERSION = '1';

/**
 * Lower-case the deterministic GitHub review event into the persisted
 * `CiVerdict` the server ingests (AC-16). The event itself comes from
 * `toReviewPayload` (grounded findings + `ci_fail_on`), NEVER the model's
 * self-reported verdict — this is a rename, not a re-decision (AC-10).
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

export interface BuildResultArtifactInput {
  findings: Finding[];
  costUsd: number | null;
  durationMs: number;
  agent: string;
  prNumber: number;
  /** Deterministic verdict (AC-16) — from `eventToVerdict(payload.event)`. */
  verdict: CiVerdict;
  /** "owner/name" (AC-16) — ingest matches this against the installation repo. */
  repository: string;
  commitSha?: string | null;
  runId?: string | null;
  runAttempt?: number | null;
}

function severityCounts(findings: Finding[]): { critical: number; warning: number; suggestion: number } {
  const counts = { critical: 0, warning: 0, suggestion: 0 };
  for (const f of findings) {
    if (f.severity === 'CRITICAL') counts.critical++;
    else if (f.severity === 'WARNING') counts.warning++;
    else counts.suggestion++;
  }
  return counts;
}

/**
 * Build + validate the `devdigest-result.json` artifact (AC-26). Validated
 * against the SAME `CiResultArtifact` Zod contract the studio's ingest path
 * (T6) will `safeParse` on the way back in, so a malformed artifact fails
 * loudly here rather than silently on ingest.
 */
export function buildResultArtifact(input: BuildResultArtifactInput): CiResultArtifact {
  const counts = severityCounts(input.findings);
  const candidate = {
    findings_count: input.findings.length,
    critical: counts.critical,
    warning: counts.warning,
    suggestion: counts.suggestion,
    cost_usd: input.costUsd,
    duration_ms: input.durationMs,
    agent: input.agent,
    version: RUNNER_VERSION,
    pr_number: input.prNumber,
    repository: input.repository,
    verdict: input.verdict,
    commit_sha: input.commitSha ?? null,
    run_id: input.runId ?? null,
    run_attempt: input.runAttempt ?? null,
  };
  const result = CiResultArtifact.safeParse(candidate);
  if (!result.success) {
    // Should be unreachable — every field above is shaped to the schema. If
    // this ever fires it's a genuine internal bug, not a user/config error.
    throw new RunnerError(
      `Internal error: built result artifact failed CiResultArtifact validation: ${result.error.message}`,
    );
  }
  return result.data;
}
