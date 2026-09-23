import { and, count, desc, eq, inArray, sum } from 'drizzle-orm';
import type { PrDetail, PrMeta } from '@devdigest/shared';
import type { Db } from '../../../../../db/client.js';
import * as t from '../../../../../db/schema.js';

export type PullRow = typeof t.pullRequests.$inferSelect;
export type RepoRow = typeof t.repos.$inferSelect;

export class PullsRepository {
  constructor(private readonly db: Db) {}

  async findRepo(workspaceId: string, repoId: string): Promise<RepoRow | undefined> {
    const [repo] = await this.db.select().from(t.repos).where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return repo;
  }

  async syncPulls(workspaceId: string, repoId: string, pulls: PrMeta[]): Promise<void> {
    for (const pr of pulls) {
      await this.db.insert(t.pullRequests).values({
        workspaceId, repoId, number: pr.number, title: pr.title, author: pr.author,
        branch: pr.branch, base: pr.base, headSha: pr.head_sha, additions: pr.additions,
        deletions: pr.deletions, filesCount: pr.files_count, status: pr.status,
        openedAt: pr.opened_at ? new Date(pr.opened_at) : null,
        updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
      }).onConflictDoUpdate({
        target: [t.pullRequests.repoId, t.pullRequests.number],
        set: { title: pr.title, headSha: pr.head_sha, status: pr.status, updatedAt: pr.updated_at ? new Date(pr.updated_at) : null },
      });
    }
  }

  listPulls(repoId: string): Promise<PullRow[]> {
    return this.db.select().from(t.pullRequests).where(eq(t.pullRequests.repoId, repoId));
  }

  async updatePullStats(id: string, additions: number, deletions: number, filesCount: number): Promise<void> {
    await this.db.update(t.pullRequests).set({ additions, deletions, filesCount }).where(eq(t.pullRequests.id, id));
  }

  reviewRollups(prIds: string[]) {
    if (prIds.length === 0) return Promise.resolve([] as { id: string; prId: string; agentId: string | null; score: number | null }[]);
    return this.db.select({ id: t.reviews.id, prId: t.reviews.prId, agentId: t.reviews.agentId, score: t.reviews.score })
      .from(t.reviews).where(and(inArray(t.reviews.prId, prIds), eq(t.reviews.kind, 'review'))).orderBy(desc(t.reviews.createdAt));
  }

  costRollups(workspaceId: string, prIds: string[]) {
    if (prIds.length === 0) return Promise.resolve([] as { prId: string | null; totalCost: string | null }[]);
    return this.db.select({ prId: t.agentRuns.prId, totalCost: sum(t.agentRuns.costUsd) })
      .from(t.agentRuns).where(and(inArray(t.agentRuns.prId, prIds), eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.status, 'done')))
      .groupBy(t.agentRuns.prId);
  }

  findingCounts(reviewIds: string[]) {
    if (reviewIds.length === 0) return Promise.resolve([] as { reviewId: string; severity: string; n: number }[]);
    return this.db.select({ reviewId: t.findings.reviewId, severity: t.findings.severity, n: count() })
      .from(t.findings).where(inArray(t.findings.reviewId, reviewIds)).groupBy(t.findings.reviewId, t.findings.severity);
  }

  async resolvePullAndRepo(workspaceId: string, id: string) {
    const [pull] = await this.db.select().from(t.pullRequests).where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, id)));
    if (!pull) return undefined;
    const [repo] = await this.db.select().from(t.repos).where(eq(t.repos.id, pull.repoId));
    return repo ? { pull, repo } : undefined;
  }

  async replacePullDetail(id: string, detail: PrDetail): Promise<void> {
    await this.db.delete(t.prFiles).where(eq(t.prFiles.prId, id));
    if (detail.files.length) await this.db.insert(t.prFiles).values(detail.files.map((f) => ({ prId: id, path: f.path, additions: f.additions, deletions: f.deletions, patch: f.patch ?? null })));
    await this.db.delete(t.prCommits).where(eq(t.prCommits.prId, id));
    if (detail.commits.length) await this.db.insert(t.prCommits).values(detail.commits.map((c) => ({ prId: id, sha: c.sha, message: c.message, author: c.author, committedAt: c.committed_at ? new Date(c.committed_at) : null })));
    await this.db.update(t.pullRequests).set({ body: detail.body ?? null, additions: detail.additions, deletions: detail.deletions, filesCount: detail.files_count }).where(eq(t.pullRequests.id, id));
  }

  listFiles(id: string) { return this.db.select().from(t.prFiles).where(eq(t.prFiles.prId, id)); }
  listCommits(id: string) { return this.db.select().from(t.prCommits).where(eq(t.prCommits.prId, id)); }
  async persistedDetail(id: string) { return { files: await this.listFiles(id), commits: await this.listCommits(id) }; }
}
