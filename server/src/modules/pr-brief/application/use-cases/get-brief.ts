import type { PrBrief } from '@devdigest/shared';
import type { BriefStorePort } from '../ports/brief-ports.js';

/**
 * Pure read: one database read, no LLM, no GitHub call (AC-7).
 * `undefined` = the PR is not in the workspace; `null` = no brief stored yet.
 */
export function createGetBrief({ store }: { store: BriefStorePort }) {
  return (workspaceId: string, pullId: string): Promise<PrBrief | null | undefined> => store.get(workspaceId, pullId);
}
