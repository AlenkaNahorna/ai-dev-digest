import { clipText } from './text.js';

/**
 * Pure shaping of persisted reviews into the compact shape shared by
 * `get_findings` and `run_agent_on_pr` (plan "Tool contracts"). Imports nothing
 * outside `domain/`; input types are structural so any port row fits.
 *
 * Everything in a review is untrusted (agent names, titles, rationales come from
 * LLM output / PR content): every string is flattened and clipped here.
 */

export type SeverityLevel = 'CRITICAL' | 'WARNING' | 'SUGGESTION';

export interface ReviewFindingInput {
  readonly severity: SeverityLevel;
  readonly title: string;
  readonly file: string;
  readonly start_line: number;
  readonly rationale: string;
}

export interface ReviewInput {
  readonly id: string;
  readonly run_id: string | null;
  readonly agent_id: string | null;
  readonly agent_name?: string | null | undefined;
  readonly kind: 'summary' | 'review';
  readonly verdict: 'approve' | 'comment' | 'request_changes' | null;
  readonly score: number | null;
  readonly created_at: string;
  readonly findings: readonly ReviewFindingInput[];
}

export interface ShapedFinding {
  severity: SeverityLevel;
  file: string;
  line: number;
  title: string;
  why: string;
}

export interface ShapedReview {
  run_id: string | null;
  agent: string;
  verdict: 'approve' | 'comment' | 'request_changes' | null;
  score: number | null;
  counts: { critical: number; warning: number; suggestion: number };
  findings: ShapedFinding[];
  /** Number of findings (after the severity filter) cut by the cap. */
  more: number;
}

export interface ShapeOptions {
  /** Keep findings of this severity and above. */
  readonly minSeverity?: SeverityLevel | undefined;
}

export const MAX_FINDINGS = 10;
export const WHY_MAX = 300;
const TITLE_MAX = 200;
const FILE_MAX = 300;
const AGENT_MAX = 60;
const RUN_ID_MAX = 64;

const RANK: Record<SeverityLevel, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

/**
 * Shape ONE review. `counts` always describe the FULL review (every finding),
 * not the filtered list, so "2 critical" stays true when the caller asked for
 * CRITICAL only; `findings` is filtered, sorted (stable) by severity and capped
 * at MAX_FINDINGS, with `more` = filtered findings that did not fit.
 */
export function shapeReview(review: ReviewInput, options: ShapeOptions = {}): ShapedReview {
  const counts = { critical: 0, warning: 0, suggestion: 0 };
  for (const f of review.findings) {
    if (f.severity === 'CRITICAL') counts.critical += 1;
    else if (f.severity === 'WARNING') counts.warning += 1;
    else counts.suggestion += 1;
  }
  const maxRank = options.minSeverity === undefined ? RANK.SUGGESTION : RANK[options.minSeverity];
  const kept = review.findings
    .filter((f) => RANK[f.severity] <= maxRank)
    .map((f, index) => ({ f, index }))
    .sort((a, b) => RANK[a.f.severity] - RANK[b.f.severity] || a.index - b.index)
    .map(({ f }) => f);
  const findings = kept.slice(0, MAX_FINDINGS).map(
    (f): ShapedFinding => ({
      severity: f.severity,
      file: clipText(f.file, FILE_MAX),
      line: f.start_line,
      title: clipText(f.title, TITLE_MAX),
      why: clipText(f.rationale, WHY_MAX),
    }),
  );
  return {
    run_id: review.run_id === null ? null : clipText(review.run_id, RUN_ID_MAX),
    agent: clipText(review.agent_name ?? '', AGENT_MAX),
    verdict: review.verdict,
    score: review.score,
    counts,
    findings,
    more: kept.length - findings.length,
  };
}

function timeOf(review: ReviewInput): number {
  const t = Date.parse(review.created_at);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/**
 * Only `kind === 'review'` rows, newest per agent (a rerun supersedes older
 * reviews; counting history would double-count — server/INSIGHTS 2026-09-23).
 * Agent identity = `agent_id`, else `agent_name`, else the review id. On equal
 * timestamps the row later in the input wins. Result is ordered newest first.
 */
export function newestReviewPerAgent<T extends ReviewInput>(reviews: readonly T[]): T[] {
  const newest = new Map<string, { review: T; index: number }>();
  reviews.forEach((review, index) => {
    if (review.kind !== 'review') return;
    const key = review.agent_id ?? review.agent_name ?? review.id;
    const current = newest.get(key);
    if (current === undefined || timeOf(review) >= timeOf(current.review)) {
      newest.set(key, { review, index });
    }
  });
  return [...newest.values()]
    .sort((a, b) => timeOf(b.review) - timeOf(a.review) || b.index - a.index)
    .map((e) => e.review);
}

/** Newest review per agent, each shaped. Empty when there is no `review` row. */
export function shapeReviews(reviews: readonly ReviewInput[], options: ShapeOptions = {}): ShapedReview[] {
  return newestReviewPerAgent(reviews).map((r) => shapeReview(r, options));
}
