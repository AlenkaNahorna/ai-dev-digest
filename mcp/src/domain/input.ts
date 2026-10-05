/** Pure validation of tool arguments that are later used to look things up. */

export interface RepoRef {
  readonly owner: string;
  readonly name: string;
}

/**
 * Anchored `owner/name` pattern (GitHub rules: owner = alphanumerics and
 * hyphens, max 39 chars; name = alphanumerics, `.`, `_`, `-`, max 100 chars).
 * No slashes or whitespace beyond the single separator.
 */
export const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

export function parseRepoRef(input: string): RepoRef | null {
  if (!REPO_PATTERN.test(input)) return null;
  const [owner, name] = input.split('/');
  if (owner === undefined || name === undefined) return null;
  if (name === '.' || name === '..') return null;
  return { owner, name };
}

/** A PR number: a positive safe integer. */
export function isPrNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Case-insensitive comparison key for repo full names and agent names. */
export function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}
