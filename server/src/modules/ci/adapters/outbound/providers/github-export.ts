import type { GitHubClient, RepoRef } from '@devdigest/shared';
import {
  GitHubExportError,
  type CommitExportInput,
  type GitHubExportPort,
  type OpenPrInput,
} from '../../../application/ports/github-export.js';

/**
 * Outbound adapter implementing `GitHubExportPort` by delegating to the shared
 * `GitHubClient` (`container.github()`). This is the ONLY place the `ci` module
 * touches Octokit/GitHub plumbing; the use-case depends on the port. Any GitHub
 * failure is wrapped in `GitHubExportError` so the use-case can map it to a
 * clear "write nothing" error (AC-6). Never writes the default branch — all
 * writes go to the caller-specified `branch` (`devdigest/ci`).
 */
export class GitHubExportAdapter implements GitHubExportPort {
  constructor(private readonly client: GitHubClient) {}

  async commitFiles(input: CommitExportInput): Promise<void> {
    const repo = parseRepo(input.repo);
    try {
      await this.client.commitFiles(repo, {
        branch: input.branch,
        base: input.base,
        message: input.message,
        files: input.files,
      });
    } catch (err) {
      throw new GitHubExportError(
        `Failed to commit files to ${input.repo}@${input.branch}: ${(err as Error).message}`,
      );
    }
  }

  async findOpenPr(repoStr: string, branch: string): Promise<{ url: string } | null> {
    const repo = parseRepo(repoStr);
    try {
      return await this.client.findOpenPr(repo, branch);
    } catch (err) {
      throw new GitHubExportError(
        `Failed to look up the open PR for ${repoStr}@${branch}: ${(err as Error).message}`,
      );
    }
  }

  async openPullRequest(input: OpenPrInput): Promise<{ url: string }> {
    const repo = parseRepo(input.repo);
    try {
      return await this.client.openPullRequest(repo, {
        title: input.title,
        head: input.head,
        base: input.base,
        body: input.body,
      });
    } catch (err) {
      throw new GitHubExportError(
        `Failed to open a PR on ${input.repo}: ${(err as Error).message}`,
      );
    }
  }
}

/** Split "owner/name" into a `RepoRef`. Throws (as a GitHub error) if malformed. */
function parseRepo(repo: string): RepoRef {
  const slash = repo.indexOf('/');
  const owner = slash > 0 ? repo.slice(0, slash) : '';
  const name = slash > 0 ? repo.slice(slash + 1) : '';
  if (!owner || !name || name.includes('/')) {
    throw new GitHubExportError(`Invalid repository "${repo}" — expected "owner/name"`);
  }
  return { owner, name };
}
