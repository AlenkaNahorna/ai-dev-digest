import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../../../db/client.js';
import * as t from '../../../../../db/schema.js';
import type { GitHubClient } from '@devdigest/shared';

export class PollingRepository {
  constructor(private readonly db: Db) {}

  findRepo(workspaceId: string, repoId: string) {
    return this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)))
      .then(([repo]) => repo);
  }

  async syncPullRequests(workspaceId: string, repoId: string, pulls: Awaited<ReturnType<GitHubClient['listPullRequests']>>) {
    for (const pr of pulls) {
      await this.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: pr.number,
          title: pr.title,
          author: pr.author,
          branch: pr.branch,
          base: pr.base,
          headSha: pr.head_sha,
          additions: pr.additions,
          deletions: pr.deletions,
          filesCount: pr.files_count,
          status: pr.status,
          updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
        })
        .onConflictDoUpdate({
          target: [t.pullRequests.repoId, t.pullRequests.number],
          set: {
            title: pr.title,
            headSha: pr.head_sha,
            status: pr.status,
            updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
          },
        });
    }
  }

  touchRepo(repoId: string) {
    return this.db.update(t.repos).set({ lastPolledAt: new Date() }).where(eq(t.repos.id, repoId));
  }
}
