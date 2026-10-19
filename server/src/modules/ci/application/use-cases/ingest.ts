import type { CiResultArtifact } from '@devdigest/shared';
import type { CiFailOn } from '@devdigest/shared';
import type { CiRepositoryPort } from '../ports/ci-repository.js';
import type { IngestTokenPort } from '../ports/ingest-token.js';
import { CiError } from '../errors.js';

export interface IngestDeps {
  repo: CiRepositoryPort;
  token: IngestTokenPort;
  now?: () => Date;
}

export interface IngestRequest {
  /** Raw bearer token from the `Authorization` header (may be undefined). */
  bearer: string | undefined;
  /** Already Zod-validated `CiResultArtifact` body. */
  artifact: CiResultArtifact;
}

/**
 * Ingest use-case (AC-15..AC-18). Authenticated by the per-installation hashed
 * bearer token — NOT workspace auth. Security (`security` skill):
 *   - A07: look the installation up by the token HASH; a missing, unknown, or
 *     non-matching token all yield the SAME generic `unauthorized` error (no
 *     enumeration), and the hash compare is constant-time (IngestTokenPort).
 *   - A01: scoping comes from the token, never a client-supplied id; the
 *     artifact's `repository` must match the installation's repo (AC-16).
 *   - A09: the bearer token is never logged (callers must not log it either).
 * Writes exactly one `ci_runs` row (AC-17), idempotent on
 * `(installation, run_id, run_attempt)` via the unique index (AC-18), and mirrors
 * it into `agent_runs` with `source = 'ci'` in the same transaction so CI reviews
 * show up in agent performance/observability next to local ones. Never touches
 * run_traces / multi_agent_runs (a CI run has no trace).
 */
export function createIngest(deps: IngestDeps) {
  const now = deps.now ?? (() => new Date());
  return async function ingest(req: IngestRequest): Promise<{ ok: true; deduped: boolean }> {
    const bearer = req.bearer?.trim();
    if (!bearer) throw new CiError('unauthorized', 'Invalid ingest credentials');

    const tokenHash = deps.token.hash(bearer);
    const installation = await deps.repo.findInstallationByTokenHash(tokenHash);
    // Generic rejection whether the installation is missing OR its stored hash
    // fails the constant-time compare — no distinction leaks to the caller.
    if (!installation || !installation.tokenHash || !deps.token.verify(bearer, installation.tokenHash)) {
      throw new CiError('unauthorized', 'Invalid ingest credentials');
    }

    // AC-16: reject if the artifact repo does not match the installation repo.
    // GitHub owner/repo names are case-insensitive (the runner sends the
    // canonical `GITHUB_REPOSITORY`, the installation stores what was typed/picked).
    if (req.artifact.repository.toLowerCase() !== installation.repo.toLowerCase()) {
      throw new CiError('repo_mismatch', 'Invalid ingest payload');
    }

    const a = req.artifact;
    const ranAt = now();
    const { inserted } = await deps.repo.insertCiRun(
      {
        ciInstallationId: installation.id,
        prNumber: a.pr_number ?? null,
        ranAt,
        verdict: a.verdict,
        findingsCount: a.findings_count,
        critical: a.critical ?? null,
        warning: a.warning ?? null,
        suggestion: a.suggestion ?? null,
        costUsd: a.cost_usd,
        durationMs: a.duration_ms ?? null,
        commitSha: a.commit_sha ?? null,
        runId: a.run_id ?? null,
        // NULLs are distinct in a Postgres unique index, so a missing attempt would
        // defeat the (installation, run_id, run_attempt) dedupe (AC-18). GitHub
        // attempts start at 1: default it whenever the run id is known.
        runAttempt: a.run_attempt ?? (a.run_id ? 1 : null),
        githubUrl: buildActionsUrl(installation.repo, a.run_id),
        source: 'gha',
      },
      {
        workspaceId: installation.workspaceId,
        agentId: installation.agentId,
        repo: installation.repo,
        prNumber: a.pr_number ?? null,
        ranAt,
        provider: installation.agentProvider,
        model: installation.agentModel,
        durationMs: a.duration_ms ?? null,
        costUsd: a.cost_usd,
        // The runner only ships an artifact after a completed, grounded review.
        status: 'succeeded',
        findingsCount: a.findings_count,
        blockers: countBlockers(installation.agentCiFailOn, a),
      },
    );

    // AC-18: a duplicate submission is a success WITHOUT a second row.
    return { ok: true, deduped: !inserted };
  };
}

/** The Actions job URL for a run, when the run id is known (AC-17/AC-19). */
function buildActionsUrl(repo: string, runId: string | null | undefined): string | null {
  if (!runId) return null;
  return `https://github.com/${repo}/actions/runs/${runId}`;
}

/**
 * Findings that tripped the agent's gate, derived from the severity counts and
 * the agent's `ci_fail_on` — same thresholds as reviewer-core's `countBlockers`
 * (critical / warning+ / any / never).
 */
function countBlockers(
  failOn: CiFailOn,
  a: { critical?: number | null; warning?: number | null; suggestion?: number | null; findings_count: number },
): number {
  const critical = a.critical ?? 0;
  const warning = a.warning ?? 0;
  switch (failOn) {
    case 'never':
      return 0;
    case 'critical':
      return critical;
    case 'warning':
      return critical + warning;
    case 'any':
      return a.findings_count;
    default:
      return 0;
  }
}
