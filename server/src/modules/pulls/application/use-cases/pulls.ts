import type { PrDetail, PrMeta, PrReviewComment, GitHubClient } from '@devdigest/shared';
import { deriveReviewStatus } from '../../status.js';
import type { PullsGithubResolver, PullsLogger, PullsRepositoryPort, PullsCommentInput } from '../ports.js';

export class PullsProviderError extends Error {
  constructor(public readonly reason: 'unavailable' | 'failed', message: string, public readonly causeValue?: unknown) { super(message); }
}

export class PullsService {
  constructor(private readonly repository: PullsRepositoryPort, private readonly github: PullsGithubResolver) {}

  async list(workspaceId: string, repoId: string, logger: PullsLogger): Promise<PrMeta[] | undefined> {
    const repo = await this.repository.findRepo(workspaceId, repoId);
    if (!repo) return undefined;
    const gh = await this.tryGithub(logger, 'GitHub client unavailable (no token / offline); serving persisted PRs');
    if (gh) {
      try { await this.repository.syncPulls(workspaceId, repo.id, await gh.listPullRequests({ owner: repo.owner, name: repo.name })); }
      catch (err) { logger.warn({ err }, 'GitHub PR sync skipped (no token / offline); serving persisted PRs'); }
    }
    const rows = await this.repository.listPulls(repo.id);
    if (gh) {
      for (const row of rows.filter((r) => r.additions === 0 && r.deletions === 0 && r.filesCount === 0).slice(0, 10)) {
        try {
          const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, row.number);
          await this.repository.updatePullStats(row.id, detail.additions, detail.deletions, detail.files_count);
          row.additions = detail.additions; row.deletions = detail.deletions; row.filesCount = detail.files_count;
        } catch (err) { logger.warn({ err, number: row.number }, 'PR diff-stat backfill skipped'); }
      }
    }
    const prIds = rows.map((r) => r.id);
    const [reviewRows, costRows] = await Promise.all([this.repository.reviewRollups(prIds), this.repository.costRollups(workspaceId, prIds)]);
    const latestReviewByPr = new Map<string, { score: number | null; reviewId: string }>();
    const reviewIdsByPr = new Map<string, string[]>();
    const seenAgentsByPr = new Map<string, Set<string>>();
    for (const rv of reviewRows) {
      if (!latestReviewByPr.has(rv.prId)) latestReviewByPr.set(rv.prId, { score: rv.score, reviewId: rv.id });
      const agentKey = rv.agentId ?? `review:${rv.id}`;
      const seen = seenAgentsByPr.get(rv.prId) ?? new Set<string>();
      if (!seen.has(agentKey)) { seen.add(agentKey); seenAgentsByPr.set(rv.prId, seen); (reviewIdsByPr.get(rv.prId) ?? (reviewIdsByPr.set(rv.prId, []), reviewIdsByPr.get(rv.prId)!)).push(rv.id); }
    }
    const costByPr = new Map<string, number | null>();
    for (const row of costRows) if (row.prId) costByPr.set(row.prId, row.totalCost == null ? null : Number(row.totalCost));
    const reviewToPr = new Map<string, string>();
    for (const [prId, ids] of reviewIdsByPr) for (const id of ids) reviewToPr.set(id, prId);
    const findingsByPr = new Map<string, { critical: number; warning: number; suggestion: number }>();
    for (const row of await this.repository.findingCounts([...reviewToPr.keys()])) {
      const prId = reviewToPr.get(row.reviewId); if (!prId) continue;
      const entry = findingsByPr.get(prId) ?? { critical: 0, warning: 0, suggestion: 0 };
      if (row.severity === 'CRITICAL') entry.critical = Number(row.n);
      else if (row.severity === 'WARNING') entry.warning = Number(row.n);
      else if (row.severity === 'SUGGESTION') entry.suggestion = Number(row.n);
      findingsByPr.set(prId, entry);
    }
    const now = Date.now();
    return rows.map((r) => {
      const review = latestReviewByPr.get(r.id);
      return { id: r.id, number: r.number, title: r.title, author: r.author, branch: r.branch, base: r.base,
        head_sha: r.headSha, additions: r.additions, deletions: r.deletions, files_count: r.filesCount,
        status: deriveReviewStatus({ ghStatus: r.status, lastReviewedSha: r.lastReviewedSha, headSha: r.headSha, updatedAt: r.updatedAt, now }),
        opened_at: r.openedAt?.toISOString() ?? null, updated_at: r.updatedAt?.toISOString() ?? null,
        score: review?.score ?? null, cost_usd: costByPr.get(r.id) ?? null,
        findings: review ? findingsByPr.get(r.id) ?? { critical: 0, warning: 0, suggestion: 0 } : null };
    });
  }

  async detail(workspaceId: string, id: string, logger: PullsLogger): Promise<PrDetail | undefined> {
    const resolved = await this.repository.resolvePullAndRepo(workspaceId, id); if (!resolved) return undefined;
    const { pull, repo } = resolved;
    try { const detail = await (await this.github.resolve()).getPullRequest({ owner: repo.owner, name: repo.name }, pull.number); await this.repository.replacePullDetail(pull.id, detail); return { ...detail, id: pull.id }; }
    catch (err) {
      logger.warn({ err }, 'GitHub PR detail refresh skipped (no token / offline); serving persisted detail');
      const { files, commits } = await this.repository.persistedDetail(pull.id);
      return { id: pull.id, number: pull.number, title: pull.title, author: pull.author, branch: pull.branch, base: pull.base, head_sha: pull.headSha, additions: pull.additions, deletions: pull.deletions, files_count: pull.filesCount, status: pull.status as PrDetail['status'], opened_at: pull.openedAt?.toISOString() ?? null, updated_at: pull.updatedAt?.toISOString() ?? null, body: pull.body ?? null, files, commits: commits.map((c) => ({ sha: c.sha, message: c.message, author: c.author, committed_at: c.committedAt?.toISOString() ?? null })) };
    }
  }

  async listComments(workspaceId: string, id: string, logger: PullsLogger): Promise<PrReviewComment[] | undefined> {
    const resolved = await this.repository.resolvePullAndRepo(workspaceId, id); if (!resolved) return undefined;
    try { return await (await this.github.resolve()).listReviewComments({ owner: resolved.repo.owner, name: resolved.repo.name }, resolved.pull.number); }
    catch (err) { logger.warn({ err }, 'GitHub review-comments fetch skipped (offline / error)'); return []; }
  }

  async createComment(workspaceId: string, id: string, input: PullsCommentInput): Promise<PrReviewComment | undefined> {
    const resolved = await this.repository.resolvePullAndRepo(workspaceId, id); if (!resolved) return undefined;
    let gh: GitHubClient;
    try { gh = await this.github.resolve(); } catch { throw new PullsProviderError('unavailable', 'Connect a GitHub token to post comments.'); }
    try { return await gh.createReviewComment({ owner: resolved.repo.owner, name: resolved.repo.name }, resolved.pull.number, { ...input, commitId: resolved.pull.headSha }); }
    catch (err) { throw new PullsProviderError('failed', err instanceof Error ? err.message : 'Failed to post the comment to GitHub.', err); }
  }

  private async tryGithub(logger: PullsLogger, message: string): Promise<GitHubClient | null> { try { return await this.github.resolve(); } catch (err) { logger.warn({ err }, message); return null; } }
}
