import type { PrDetail, PrMeta, PrReviewComment, GitHubClient } from '@devdigest/shared';

export interface PullRow {
  id: string; repoId: string; number: number; title: string; author: string;
  branch: string; base: string; headSha: string; lastReviewedSha: string | null;
  additions: number; deletions: number; filesCount: number; status: string;
  body: string | null; openedAt: Date | null; updatedAt: Date | null;
}
export interface RepoRow { id: string; owner: string; name: string; }

export interface PullsLogger {
  warn(meta: unknown, message: string): void;
}

export interface PullsRepositoryPort {
  findRepo(workspaceId: string, repoId: string): Promise<RepoRow | undefined>;
  syncPulls(workspaceId: string, repoId: string, pulls: PrMeta[]): Promise<void>;
  listPulls(repoId: string): Promise<PullRow[]>;
  updatePullStats(id: string, additions: number, deletions: number, filesCount: number): Promise<void>;
  reviewRollups(prIds: string[]): Promise<{ id: string; prId: string; agentId: string | null; score: number | null }[]>;
  costRollups(workspaceId: string, prIds: string[]): Promise<{ prId: string | null; totalCost: string | null }[]>;
  findingCounts(reviewIds: string[]): Promise<{ reviewId: string; severity: string; n: number }[]>;
  resolvePullAndRepo(workspaceId: string, id: string): Promise<{ pull: PullRow; repo: RepoRow } | undefined>;
  replacePullDetail(id: string, detail: PrDetail): Promise<void>;
  persistedDetail(id: string): Promise<{ files: { path: string; additions: number; deletions: number; patch: string | null }[]; commits: { sha: string; message: string; author: string; committedAt: Date | null }[] }>;
  listFiles(id: string): Promise<{ path: string; additions: number; deletions: number; patch: string | null }[]>;
  listCommits(id: string): Promise<{ sha: string; message: string; author: string; committedAt: Date | null }[]>;
}

export interface PullsGithubResolver {
  resolve(): Promise<GitHubClient>;
}

export type PullsCommentInput = Parameters<GitHubClient['createReviewComment']>[2];
export type { PrReviewComment };
