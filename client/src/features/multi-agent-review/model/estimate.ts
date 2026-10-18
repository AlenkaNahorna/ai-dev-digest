/* Pure estimate aggregation for the picker footer (AC-11..16).
   - Total time ≈ max(longest single agent, sum of durations / POOL_SIZE) — the
     executor runs up to POOL_SIZE=3 agents at once, so wall-clock is bounded by
     the longest job but at least the serial sum spread across the pool.
   - Total cost = sum of per-agent mean costs (agents with no cost sample are
     excluded from the sum, mirroring the server's null-cost exclusion).
   - "No estimate" when no selected agent has a usable sample. Always labelled
     approximate by the caller. */

import type { AgentEstimate } from "@devdigest/shared";

/** Must match the server executor's concurrency (POOL_SIZE); kept here only to spread the serial sum. */
export const ESTIMATE_POOL_SIZE = 3;

export interface EstimateSummary {
  /** True when at least one selected agent has a duration sample. */
  hasEstimate: boolean;
  /** Approx wall-clock ms, or null when no duration sample exists. */
  totalDurationMs: number | null;
  /** Summed mean cost in USD, or null when no cost sample exists. */
  totalCostUsd: number | null;
  /** Agents in the selection that had no usable sample. */
  missingSampleCount: number;
}

export function summarizeEstimates(estimates: AgentEstimate[]): EstimateSummary {
  const durations = estimates
    .map((e) => e.mean_duration_ms)
    .filter((d): d is number => d != null && Number.isFinite(d));
  const costs = estimates
    .map((e) => e.mean_cost_usd)
    .filter((c): c is number => c != null && Number.isFinite(c));
  const missingSampleCount = estimates.filter((e) => e.sample_size < 1).length;

  const totalDurationMs = durations.length
    ? Math.max(Math.max(...durations), Math.round(durations.reduce((a, b) => a + b, 0) / ESTIMATE_POOL_SIZE))
    : null;
  const totalCostUsd = costs.length ? costs.reduce((a, b) => a + b, 0) : null;

  return {
    hasEstimate: durations.length > 0 || costs.length > 0,
    totalDurationMs,
    totalCostUsd,
    missingSampleCount,
  };
}
