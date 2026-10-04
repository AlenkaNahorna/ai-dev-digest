import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../../../db/client.js';
import * as t from '../../../../../db/schema.js';
import type { BlastPullFilesPort } from '../../../application/ports/blast-ports.js';

export class BlastRepository implements BlastPullFilesPort {
  constructor(private readonly db: Db) {}

  async resolvePullFiles(workspaceId: string, pullId: string): Promise<{ repoId: string; changedFiles: string[] } | undefined> {
    const [pull] = await this.db
      .select({ repoId: t.pullRequests.repoId })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, pullId)));
    if (!pull) return undefined;
    const rows = await this.db.select({ path: t.prFiles.path }).from(t.prFiles).where(eq(t.prFiles.prId, pullId));
    return { repoId: pull.repoId, changedFiles: [...new Set(rows.map((r) => r.path))] };
  }
}
