/**
 * Narrow port the `ci` export use-case depends on for GitHub writes. The
 * concrete adapter (`adapters/outbound/providers/github-export.ts`) delegates to
 * `container.github()` (`GitHubClient.commitFiles`/`findOpenPr`/`openPullRequest`).
 * Application/domain code depends only on THIS interface — never on Octokit, the
 * `Container`, or `GitHubClient` directly (onion-architecture: ports owned here).
 */

export interface ExportFile {
  path: string;
  contents: string;
}

export interface CommitExportInput {
  repo: string; // "owner/name"
  branch: string;
  base: string;
  message: string;
  files: ExportFile[];
}

export interface OpenPrInput {
  repo: string; // "owner/name"
  title: string;
  head: string;
  base: string;
  body: string;
}

/**
 * Thrown by the adapter when GitHub refuses the write (missing permission, no
 * such repo, …). The use-case lets this propagate so nothing is persisted and
 * the route maps it to a clear error with no partial state (AC-6).
 */
export class GitHubExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubExportError';
  }
}

export interface GitHubExportPort {
  /** Commit `files` onto `branch` (create from `base` if missing). */
  commitFiles(input: CommitExportInput): Promise<void>;
  /** The open PR whose head is `branch`, if any (reuse on re-export — AC-5). */
  findOpenPr(repo: string, branch: string): Promise<{ url: string } | null>;
  /** Open a new PR; returns its URL. */
  openPullRequest(input: OpenPrInput): Promise<{ url: string }>;
}
