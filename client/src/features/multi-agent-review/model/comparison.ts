/* "1 vs N" arithmetic (AC-48..52, D9). Everything is MEASURED from the review's
   own numbers; no N-times ratio is assumed anywhere. A ratio is produced only
   when the baseline has a usable (non-null, > 0) value for that metric, and it
   is always "this review ÷ the single-agent baseline" — it can land well below
   or above N because of caching, the shared diff preparation and different
   answer lengths. */

import type { MultiAgentBaseline, MultiAgentComparison } from "@devdigest/shared";

export interface ComparisonRow {
  key: "tokens" | "cost" | "time";
  /** This review's measured value (null = unknown). */
  review: number | null;
  /** The single-agent baseline's value (null = no baseline / unknown). */
  baseline: number | null;
  /** review ÷ baseline, or null when either side is missing or the baseline is 0. */
  ratio: number | null;
}

function ratio(review: number | null, baseline: number | null): number | null {
  if (review == null || baseline == null || !Number.isFinite(review) || !Number.isFinite(baseline) || baseline <= 0) return null;
  return review / baseline;
}

function baselineTokens(b: MultiAgentBaseline | null): number | null {
  if (!b || (b.tokens_in == null && b.tokens_out == null)) return null;
  return (b.tokens_in ?? 0) + (b.tokens_out ?? 0);
}

export function comparisonRows(c: MultiAgentComparison): ComparisonRow[] {
  const b = c.baseline;
  const reviewTokens = c.tokens_in + c.tokens_out;
  const rows: ComparisonRow[] = [
    { key: "tokens", review: reviewTokens, baseline: baselineTokens(b), ratio: ratio(reviewTokens, baselineTokens(b)) },
    { key: "cost", review: c.cost_usd, baseline: b?.cost_usd ?? null, ratio: ratio(c.cost_usd, b?.cost_usd ?? null) },
    { key: "time", review: c.wall_clock_ms, baseline: b?.duration_ms ?? null, ratio: ratio(c.wall_clock_ms, b?.duration_ms ?? null) },
  ];
  return rows;
}

/** "1.9×" — one decimal, never rounds a real ratio up to a tidy N. */
export function formatRatio(r: number | null): string {
  return r == null || !Number.isFinite(r) ? "—" : `${r.toFixed(1)}×`;
}

export function formatTokenCount(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US");
}
