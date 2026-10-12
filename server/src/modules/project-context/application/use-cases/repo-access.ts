import { ProjectContextError } from '../errors.js';
import type { ReposPort, RepoInfo } from '../ports/project-context-ports.js';

/**
 * Resolve a repo the caller may use. A repo outside the caller's workspace —
 * or one that does not exist — is "forbidden" and returns no data (AC-45);
 * the two cases are deliberately indistinguishable to the client.
 */
export async function requireRepo(repos: ReposPort, workspaceId: string, repoId: string): Promise<RepoInfo> {
  const repo = await repos.findById(repoId);
  if (!repo || repo.workspaceId !== workspaceId) {
    throw new ProjectContextError('forbidden', 'Repository is not accessible in this workspace');
  }
  return repo;
}
