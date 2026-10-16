/**
 * Eval scoring — PURE CODE. No model, network, database or provider import is
 * allowed here (AC-22); `scripts/verify-l06.mjs` and `eval-scoring.test.ts`
 * both enforce it. A finding matches an expectation when the file is the same
 * and the inclusive line ranges intersect.
 */

export type ExpectationKind = 'must_find' | 'must_not_flag';

export interface Located {
  file: string;
  startLine: number;
  endLine: number;
}

export interface ScoredExpectation extends Located {
  kind: ExpectationKind;
}

export interface CaseScoreInput {
  expectation: ScoredExpectation;
  /** Findings that survived the grounding gate. */
  kept: Located[];
  /** Findings dropped by the grounding gate. */
  droppedCount: number;
  /** The run failed (model/parse error) — no findings are available. */
  errored?: boolean;
}

export interface CaseScore {
  kind: ExpectationKind;
  pass: boolean;
  errored: boolean;
  emitted: number;
  kept: number;
  dropped: number;
  hits: number;
  noise: number;
}

export interface Metrics {
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
}

/** `./x`, `a/x`, `b/x` and backslashes → `x`. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^(\.\/|a\/|b\/)+/, '');
}

export function rangesIntersect(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  const aLo = Math.min(aStart, aEnd);
  const aHi = Math.max(aStart, aEnd);
  const bLo = Math.min(bStart, bEnd);
  const bHi = Math.max(bStart, bEnd);
  return aLo <= bHi && bLo <= aHi;
}

/** AC-23: same normalized file + intersecting inclusive line ranges. */
export function isHit(finding: Located, expectation: Located): boolean {
  return (
    normalizePath(finding.file) === normalizePath(expectation.file) &&
    rangesIntersect(finding.startLine, finding.endLine, expectation.startLine, expectation.endLine)
  );
}

/** AC-24 / AC-25. */
export function scoreCase(input: CaseScoreInput): CaseScore {
  const { expectation, kept, droppedCount, errored = false } = input;
  if (errored) {
    return {
      kind: expectation.kind,
      pass: false,
      errored: true,
      emitted: 0,
      kept: 0,
      dropped: 0,
      hits: 0,
      noise: 0,
    };
  }
  const hits = kept.filter((f) => isHit(f, expectation)).length;
  const mustFind = expectation.kind === 'must_find';
  return {
    kind: expectation.kind,
    pass: mustFind ? hits > 0 : hits === 0,
    errored: false,
    emitted: kept.length + droppedCount,
    kept: kept.length,
    dropped: droppedCount,
    hits,
    noise: mustFind ? 0 : hits,
  };
}

function ratio(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

/**
 * AC-26..AC-28.
 *  recall    = passed must_find cases / must_find cases (errored count as misses)
 *  precision = (kept − noise) / kept          over non-errored cases
 *  citation  = kept / emitted                 over non-errored cases
 */
export function aggregate(scores: CaseScore[]): Metrics {
  const mustFind = scores.filter((s) => s.kind === 'must_find');
  const ok = scores.filter((s) => !s.errored);
  const kept = ok.reduce((n, s) => n + s.kept, 0);
  const noise = ok.reduce((n, s) => n + s.noise, 0);
  const emitted = ok.reduce((n, s) => n + s.emitted, 0);
  return {
    recall: ratio(mustFind.filter((s) => s.pass).length, mustFind.length),
    precision: ratio(kept - noise, kept),
    citation_accuracy: ratio(kept, emitted),
  };
}
