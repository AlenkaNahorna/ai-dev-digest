import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { PriorPr } from '@devdigest/shared';
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

  async listPriorPulls(workspaceId: string, repoId: string, pullId: string, changedFiles: string[], limit: number): Promise<PriorPr[]> {
    if (changedFiles.length === 0) return [];
    const rows = await this.db
      .select({
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        status: t.pullRequests.status,
        sharedFiles: sql<number>`count(distinct ${t.prFiles.path})::int`,
      })
      .from(t.prFiles)
      .innerJoin(t.pullRequests, eq(t.prFiles.prId, t.pullRequests.id))
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.pullRequests.repoId, repoId),
          ne(t.pullRequests.id, pullId),
          inArray(t.prFiles.path, changedFiles),
        ),
      )
      .groupBy(t.pullRequests.id)
      .orderBy(desc(t.pullRequests.number))
      .limit(limit);
    return rows.map((r) => ({ number: r.number, title: r.title, status: r.status, shared_files: r.sharedFiles }));
  }
}
