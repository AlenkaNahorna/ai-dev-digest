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
  /** Nested under byPull so every byPull invalidation also refreshes smart-diff. */
  smartDiff: (prId: string | null | undefined) => ["reviews", prId, "smart-diff"] as const,
};
export const runKeys = {
  active: (prId: string | null | undefined) => ["pr-active-runs", prId] as const,
  history: (prId: string | null | undefined) => ["pr-runs", prId] as const,
};
export const intentKeys = {
  byPull: (prId: string | null | undefined) => ["pr-intent", prId] as const,
};
/** Blast radius depends on `pr_files` + the repo index, not on reviews, so it has its own root. */
export const blastKeys = {
  byPull: (prId: string | null | undefined) => ["pr-blast", prId] as const,
};
/** The stored PR Brief has its own root (not nested under `reviewKeys.byPull`): it changes only on Generate/refresh. */
export const briefKeys = {
  byPull: (prId: string | null | undefined) => ["pr-brief", prId] as const,
};
/** Project Context: discovered docs per repo, one doc's text, and per-agent/skill attachments. */
export type ContextOwnerKind = "agent" | "skill";
export const contextKeys = {
  all: ["project-context"] as const,
  list: (repoId: string | null | undefined) => ["project-context", "list", repoId] as const,
  doc: (repoId: string | null | undefined, path: string | null | undefined) =>
    ["project-context", "doc", repoId, path] as const,
  attachments: (kind: ContextOwnerKind, ownerId: string | null | undefined, repoId: string | null | undefined) =>
    ["project-context", "attachments", kind, ownerId, repoId] as const,
};

/** Onboarding Tour: persisted state per repo, its shares, and a public snapshot by token. */
export const onboardingTourKeys = {
  all: ["onboarding-tour"] as const,
  state: (repoId: string | null | undefined) => ["onboarding-tour", "state", repoId] as const,
  shares: (repoId: string | null | undefined) => ["onboarding-tour", "shares", repoId] as const,
  /** Public snapshot — deliberately NOT under `all` so private invalidations never touch it. */
  publicSnapshot: (token: string | null | undefined) => ["public-onboarding", token] as const,
};
/** Eval pipeline (L06): cases, batches (history), one batch, compare and the dashboard overview. */
export const evalKeys = {
  all: ["evals"] as const,
  cases: (agentId: string | null | undefined) => ["evals", "cases", agentId] as const,
  batches: (agentId: string | null | undefined) => ["evals", "batches", agentId] as const,
  batch: (batchId: string | null | undefined) => ["evals", "batch", batchId] as const,
  compare: (a: string | null | undefined, b: string | null | undefined) => ["evals", "compare", a, b] as const,
  overview: ["evals", "overview"] as const,
  skillCases: (skillId: string | null | undefined) => ["evals", "skill-cases", skillId] as const,
};
