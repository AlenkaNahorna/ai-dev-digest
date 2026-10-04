import type { BlastResult } from '../../../repo-intel/types.js';

/** Workspace-scoped lookup of the files a stored pull request changes. */
export interface BlastPullFilesPort {
  /** `undefined` when the pull request does not exist in the workspace. */
  resolvePullFiles(workspaceId: string, pullId: string): Promise<{ repoId: string; changedFiles: string[] } | undefined>;
}

/** Narrow view of the repo-intel facade used by blast. */
export interface BlastIntelPort {
  getBlastRadius(repoId: string, changedFiles: string[]): Promise<BlastResult>;
}
