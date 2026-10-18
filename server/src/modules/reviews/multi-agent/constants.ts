/**
 * Multi-agent review tuning constants, defined ONCE here (D4, AC-27). Pure
 * domain values — no infra imports.
 */

/** Line-range overlap tolerance (lines) when grouping findings of two agents. */
export const LINE_TOLERANCE = 3;

/** Minimum Jaccard similarity of lowercase title tokens to group by title. */
export const TITLE_JACCARD_MIN = 0.5;

/** How many prior runs feed a per-agent estimate (D8, AC-11). */
export const ESTIMATE_SAMPLE_SIZE = 5;

/** Pool size for a multi-agent start (D2). */
export const MULTI_AGENT_POOL_SIZE = 3;

/** Allowed number of agents in one multi-agent start (inclusive). */
export const MIN_AGENTS = 1;
export const MAX_AGENTS = 6;
