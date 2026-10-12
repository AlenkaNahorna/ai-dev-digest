/**
 * Engineering budgets for the onboarding generator (plan Step 2/3). Defaults can
 * be changed only with recorded validation evidence; tests reference these
 * constants so prompts, capture and validation never drift apart.
 */

/** Evidence capture bounds. Byte/token limits are checked BEFORE concatenation. */
export const EVIDENCE_LIMITS = {
  documents: 20,
  documentBytes: 32 * 1024,
  totalDocumentBytes: 128 * 1024,
  rankedFiles: 20,
  criticalChains: 10,
  chainLength: 8,
  symbols: 100,
  excerpts: 30,
  excerptBytes: 4 * 1024,
  /** Upper bound on the token estimate of the whole evidence block. */
  evidenceTokens: 24_000,
  /** Upper bound on the serialized evidence (prompt user content), bytes. */
  serializedBytes: 256 * 1024,
  /** Git tree enumeration cap: larger inventories fall back to evidence paths only. */
  inventoryPaths: 50_000,
  repoMapChars: 12_000,
} as const;

/** Generation timing (Step 3). The provider deadline sits inside the request lease. */
export const GENERATION_TIMING = {
  providerDeadlineMs: 60_000,
  leaseMs: 120_000,
  /** Evidence capture waits at most this long for the per-repo index lock. */
  captureLockTimeoutMs: 30_000,
} as const;

/** Retention: latest N successful versions per repository (plus any share source). */
export const DEFAULT_RETAINED_VERSIONS = 5;
/** Per-repository daily cap on automatic + manual requests (configurable). */
export const DEFAULT_DAILY_BUDGET = 10;
export const BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Share tokens: 32 random bytes → 43-char base64url. */
export const SHARE_TOKEN_BYTES = 32;

/** Documents that count as "evidence" must come from this many characters/lines at most. */
export const MAX_LINE_CHARS = 2_000;
