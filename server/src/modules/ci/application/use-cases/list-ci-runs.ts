import type { CiRun } from '@devdigest/shared';
import type { CiRepositoryPort } from '../ports/ci-repository.js';

/** 50 most recent workspace CI runs is the v1 cap (AC-19, no pagination). */
export const CI_RUNS_LIMIT = 50;

/**
 * CI-Runs read (AC-19): the 50 most recent workspace CI runs (ran_at desc, id
 * desc — ordering done in the repository), mapped to the `CiRun` contract. The
 * repository returns rows; the use-case shapes the DTO (no HTTP concerns here).
 */
export function createListCiRuns(repo: CiRepositoryPort) {
  return async function listCiRuns(workspaceId: string): Promise<CiRun[]> {
    const rows = await repo.listCiRuns(workspaceId, CI_RUNS_LIMIT);
    return rows.map((r) => ({
      id: r.id,
      ci_installation_id: r.ciInstallationId,
      repo: r.repo,
      pr_number: r.prNumber,
      ran_at: r.ranAt ? r.ranAt.toISOString() : null,
      status: null,
      verdict: (r.verdict as CiRun['verdict']) ?? null,
      findings_count: r.findingsCount,
      critical: r.critical,
      warning: r.warning,
      suggestion: r.suggestion,
      cost_usd: r.costUsd,
      github_url: r.githubUrl,
      source: null,
      agent: r.agentName,
      commit_sha: r.commitSha,
      run_id: r.runId,
      run_attempt: r.runAttempt,
      duration_s: r.durationMs != null ? r.durationMs / 1000 : null,
    }));
  };
}
