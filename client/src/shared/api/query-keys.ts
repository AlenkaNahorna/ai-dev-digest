/** Typed React Query key factories. Keep cache ownership close to a feature. */
export const settingsKeys = { all: ["settings"] as const, secrets: ["secrets-status"] as const };
export const repoKeys = { all: ["repos"] as const, detail: (repoId: string) => ["repo", repoId] as const };
export const pullKeys = {
  all: ["pulls"] as const,
  list: (repoId: string | null | undefined) => ["pulls", repoId] as const,
  detail: (prId: string | number | null | undefined) => ["pull", prId] as const,
};
export const reviewKeys = {
  all: ["reviews"] as const,
  byPull: (prId: string | null | undefined) => ["reviews", prId] as const,
  comments: (prId: string | null | undefined) => ["pr-comments", prId] as const,
};
export const runKeys = {
  active: (prId: string | null | undefined) => ["pr-active-runs", prId] as const,
  history: (prId: string | null | undefined) => ["pr-runs", prId] as const,
};
export const intentKeys = {
  byPull: (prId: string | null | undefined) => ["pr-intent", prId] as const,
};
