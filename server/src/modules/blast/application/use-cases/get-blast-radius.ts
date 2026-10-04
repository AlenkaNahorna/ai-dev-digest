import type { BlastRadius } from '@devdigest/shared';
import { formatBlastSummary, mapBlast } from '../../domain/map-blast.js';
import type { BlastIntelPort, BlastPullFilesPort } from '../ports/blast-ports.js';

export interface GetBlastRadiusDeps {
  files: BlastPullFilesPort;
  intel: BlastIntelPort;
}

/**
 * Pure read: DB lookup of the PR's files + the repo-intel facade. No LLM, no
 * GitHub call. Returns `undefined` when the PR is not in the workspace.
 */
export function createGetBlastRadius({ files, intel }: GetBlastRadiusDeps) {
  return async (workspaceId: string, pullId: string): Promise<BlastRadius | undefined> => {
    const pull = await files.resolvePullFiles(workspaceId, pullId);
    if (!pull) return undefined;
    if (pull.changedFiles.length === 0) {
      return {
        changed_symbols: [],
        downstream: [],
        summary: formatBlastSummary(0, 0, 0, 0),
        degraded: true,
        degraded_reason: 'no_data',
      };
    }
    return mapBlast(await intel.getBlastRadius(pull.repoId, pull.changedFiles));
  };
}
