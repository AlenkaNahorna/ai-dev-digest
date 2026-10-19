import { z } from 'zod';
import { Severity } from './findings.js';

/**
 * A5 — Observability / Multi-agent contracts (L07).
 *
 * These are NEW contracts (A5 owns this file; the barrel re-exports it). They
 * sit alongside A2's `review-api.ts`:
 *   - MultiAgentRun        the response of POST /pulls/:id/multi-agent-run
 *   - AgentColumn          one agent's column in the multi-agent view
 *   - Conflict / ConflictTake  where agents disagree on the same file:line
 *   - AgentStats           per-agent quality aggregates (GET /agents/:id/stats)
 *   - CuratorResult        the cross-session memory curator outcome
 *
 * The single-document run trace itself stays in `contracts/trace.ts` (RunTrace).
 */

// ---------------------------------------------------------------------------
// Multi-Agent Review
// ---------------------------------------------------------------------------

/** Lifecycle state of a finding (accept/dismiss persisted on the findings row). */
export const AgentColumnFindingState = z.enum(['open', 'accepted', 'dismissed']);
export type AgentColumnFindingState = z.infer<typeof AgentColumnFindingState>;

/** A finding as surfaced in a multi-agent column (subset of FindingRecord). */
export const AgentColumnFinding = z.object({
  id: z.string(),
  /** Producing agent (attribution when a group spans agents). */
  agent_id: z.string(),
  severity: Severity,
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  rationale: z.string(),
  suggestion: z.string().nullish(),
  confidence: z.number(),
  state: AgentColumnFindingState,
  kind: z.string().nullish(),
});
export type AgentColumnFinding = z.infer<typeof AgentColumnFinding>;

/** One agent's result column in the multi-agent review. */
export const AgentColumn = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(['queued', 'done', 'failed', 'running']),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings: z.array(AgentColumnFinding),
});
export type AgentColumn = z.infer<typeof AgentColumn>;

/** One agent's stance on a contended file:line. */
export const ConflictTake = z.object({
  agent_id: z.string(),
  persona: z.string(),
  /**
   * Severity if the agent flagged it, 'ignored' when a completed agent did not
   * flag it, or 'no_result' when the agent's run failed / is still running
   * (AC-31: neither creates nor resolves a conflict).
   */
  verdict: z.union([Severity, z.literal('ignored'), z.literal('no_result')]),
  note: z.string(),
});
export type ConflictTake = z.infer<typeof ConflictTake>;

/**
 * A conflict = a file:line that at least one agent flagged and at least one
 * other agent (that also reviewed) did NOT, OR where agents assigned divergent
 * severities. Every flagged location is listed; `is_conflict` marks the actual
 * disagreements. Computed from persisted findings; not stored.
 */
export const Conflict = z.object({
  file: z.string(),
  line: z.number().int(),
  title: z.string(),
  /**
   * true = an actual disagreement (flagged vs a completed agent that did not, or
   * severities 2+ levels apart); false = a contended location where every
   * reviewing agent agreed. The "Show only conflicts" toggle filters on this
   * (AC-33). Defaults to true so older payloads keep their meaning.
   */
  is_conflict: z.boolean().default(true),
  takes: z.array(ConflictTake),
});
export type Conflict = z.infer<typeof Conflict>;

/**
 * A finding group = the ids of the findings collapsed together (computed on
 * read, never stored; AC-22/23). A group of one id is an ungrouped finding.
 */
export const FindingGroup = z.object({
  finding_ids: z.array(z.string()),
});
export type FindingGroup = z.infer<typeof FindingGroup>;

/** Derived status of a multi-agent review (from its per-agent runs). */
export const MultiAgentRunStatus = z.enum(['running', 'partial', 'failed', 'done']);
export type MultiAgentRunStatus = z.infer<typeof MultiAgentRunStatus>;

/**
 * The single-agent run used as the "1" in the "1 vs N" comparison: the most
 * recent completed single-agent run on the same PR by one of the review's agents.
 */
export const MultiAgentBaseline = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
});
export type MultiAgentBaseline = z.infer<typeof MultiAgentBaseline>;

/**
 * The intent-classifier call is made ONCE per review batch and shared by every
 * agent; its tokens/cost are recorded in the traces, not in any agent's own
 * `agent_runs` row, so they are reported beside (never inside) the per-agent
 * totals. `cached` = a persisted intent for the same head was reused (no call).
 */
export const MultiAgentSharedIntent = z.object({
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  cost_usd: z.number().nullable(),
  cached: z.boolean(),
});
export type MultiAgentSharedIntent = z.infer<typeof MultiAgentSharedIntent>;

/**
 * Measured totals for the "1 vs N" block (AC-48..52, D9). Everything here is
 * summed from the actual `agent_runs` rows and computed on read — nothing is
 * stored and no N-times ratio is assumed: caching, the shared diff preparation
 * and differing answer lengths can all move the real ratio away from N.
 */
export const MultiAgentComparison = z.object({
  agents_total: z.number().int(),
  /** Agents whose run finished with status `done` (their numbers feed the totals below). */
  agents_done: z.number().int(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  /** Sum of the KNOWN actual costs; null when no run has a known cost. */
  cost_usd: z.number().nullable(),
  /** Runs whose cost is unknown (excluded from `cost_usd`, never counted as $0). */
  cost_unknown_agents: z.number().int(),
  /** Real elapsed time from the start of the review to the last run finishing; null until a run has finished. */
  wall_clock_ms: z.number().int().nullable(),
  /** Sum of the per-agent durations, i.e. how long the same runs would take back to back. */
  sequential_sum_ms: z.number().int(),
  /** Prior single-agent run on this PR, or null ("no baseline"). */
  baseline: MultiAgentBaseline.nullable(),
  /** Shared one-off intent call (not part of the per-agent totals above), or null when none was recorded. */
  shared_intent: MultiAgentSharedIntent.nullable(),
});
export type MultiAgentComparison = z.infer<typeof MultiAgentComparison>;

/** Response of POST /pulls/:id/multi-agent-run and GET /pulls/:id/multi-agent. */
export const MultiAgentRun = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullish(),
  ran_at: z.string(),
  /** Derived from the per-agent run statuses (AC-20). */
  status: MultiAgentRunStatus,
  agent_count: z.number().int(),
  /** Real wall-clock of the review (start → last run finished), NOT the sum of the agents' durations (AC-50). */
  total_duration_ms: z.number().int(),
  total_cost_usd: z.number().nullable(),
  /** Measured totals + optional single-agent baseline for the "1 vs N" block (AC-51). */
  comparison: MultiAgentComparison,
  columns: z.array(AgentColumn),
  /** Cross-agent finding groups (ids only), computed on read (AC-22). */
  groups: z.array(FindingGroup),
  conflicts: z.array(Conflict),
});
export type MultiAgentRun = z.infer<typeof MultiAgentRun>;

/**
 * Per-agent pre-run estimate (GET estimate endpoint). mean duration + cost over
 * the agent's last 5 done, source='local' runs workspace-wide; `sample_size<1`
 * → unavailable (D8, AC-11/13/14).
 */
export const AgentEstimate = z.object({
  agent_id: z.string(),
  mean_duration_ms: z.number().nullable(),
  mean_cost_usd: z.number().nullable(),
  sample_size: z.number().int(),
});
export type AgentEstimate = z.infer<typeof AgentEstimate>;

/** Response of the multi-agent estimate endpoint: one entry per requested agent. */
export const MultiAgentEstimate = z.object({
  estimates: z.array(AgentEstimate),
});
export type MultiAgentEstimate = z.infer<typeof MultiAgentEstimate>;

// ---------------------------------------------------------------------------
// Per-agent Stats (GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/** A single (date, value) point for a sparkline/trend. */
export const StatPoint = z.object({ label: z.string(), value: z.number() });
export type StatPoint = z.infer<typeof StatPoint>;

export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  /** accept-rate is the headline quality signal. 0..1 over acted findings. */
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  /** recent runs for a small trend chart (oldest→newest). */
  trend: z.array(StatPoint),
});
export type AgentStats = z.infer<typeof AgentStats>;

// ---------------------------------------------------------------------------
// Cross-session memory curator
// ---------------------------------------------------------------------------

/** A merge the curator performed (or would perform in dry-run). */
export const CuratorMerge = z.object({
  kept_id: z.string(),
  merged_ids: z.array(z.string()),
  content: z.string(),
  similarity: z.number(),
});
export type CuratorMerge = z.infer<typeof CuratorMerge>;

export const CuratorResult = z.object({
  scanned: z.number().int(),
  merges: z.array(CuratorMerge),
  removed: z.number().int(),
  dry_run: z.boolean(),
});
export type CuratorResult = z.infer<typeof CuratorResult>;

/** Response of GET /multi-agent/latest: where the sidebar entry should land. */
export const LatestMultiAgentRun = z.object({
  latest: z.object({ pr_id: z.string(), parent_id: z.string() }).nullable(),
});
export type LatestMultiAgentRun = z.infer<typeof LatestMultiAgentRun>;
