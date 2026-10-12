import { agentsPerPath } from '../../domain/effective-set.js';
import type { UsageRepo } from '../ports/project-context-ports.js';

/**
 * "Used by N agents": distinct agents that receive each document of a repo,
 * by direct attachment or through an attached-and-enabled skill link. Counts
 * agents regardless of `agents.enabled`.
 */
export function createCountUsage({ usage }: { usage: UsageRepo }) {
  return async (workspaceId: string, repoId: string): Promise<Map<string, number>> => {
    const rows = await usage.listUsage(workspaceId, repoId);
    return agentsPerPath(rows.direct, rows.viaSkills);
  };
}

export type CountUsage = ReturnType<typeof createCountUsage>;
