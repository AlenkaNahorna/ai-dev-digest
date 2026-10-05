import type { PriorPr } from '@devdigest/shared';
import type { BlastResult } from '../../../repo-intel/types.js';

/** Workspace-scoped lookup of the files a stored pull request changes. */
export interface BlastPullFilesPort {
  /** `undefined` when the pull request does not exist in the workspace. */
  resolvePullFiles(workspaceId: string, pullId: string): Promise<{ repoId: string; changedFiles: string[] } | undefined>;
  /** Other PRs of the repo that touched any of `changedFiles`, newest first. */
  listPriorPulls(workspaceId: string, repoId: string, pullId: string, changedFiles: string[], limit: number): Promise<PriorPr[]>;
}

/** Narrow view of the repo-intel facade used by blast. */
export interface BlastIntelPort {
  getBlastRadius(repoId: string, changedFiles: string[]): Promise<BlastResult>;
}
