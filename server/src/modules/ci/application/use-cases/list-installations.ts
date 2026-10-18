import type { CiRepositoryPort } from '../ports/ci-repository.js';
import { WORKFLOW_VERSION } from '../../domain/workflow.js';

export interface CiInstallationSummary {
  id: string;
  agent_id: string;
  repo: string;
  target_type: string;
  installed_at: string | null;
  latest_verdict: string | null;
  latest_ran_at: string | null;
  workflow_version: number | null;
  latest_workflow_version: number;
  post_as: 'github_review' | 'pr_comment' | 'none' | null;
  triggers: string[] | null;
  pr_url: string | null;
}

/**
 * CI-tab read (AC-1): installations for an agent (workspace-scoped) with the
 * repo + latest run verdict/time. Workspace scoping is enforced in the
 * repository query; the use-case just maps rows to the API DTO.
 */
export function createListInstallations(repo: CiRepositoryPort) {
  return async function listInstallations(
    workspaceId: string,
    agentId: string,
  ): Promise<CiInstallationSummary[]> {
    const rows = await repo.listInstallations(workspaceId, agentId);
    return rows.map((r) => ({
      id: r.id,
      agent_id: agentId,
      repo: r.repo,
      target_type: r.targetType,
      installed_at: r.installedAt ? r.installedAt.toISOString() : null,
      latest_verdict: r.latestVerdict,
      latest_ran_at: r.latestRanAt ? r.latestRanAt.toISOString() : null,
      workflow_version: r.workflowVersion,
      latest_workflow_version: WORKFLOW_VERSION,
      post_as: r.postAs,
      triggers: r.triggers,
      pr_url: r.prUrl,
    }));
  };
}
