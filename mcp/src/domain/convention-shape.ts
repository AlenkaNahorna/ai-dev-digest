import { clipText } from './text.js';

/** Bounds for `get_conventions` (rules and paths are LLM-authored, so untrusted). */
export const CONVENTIONS_MAX = 50;
export const RULE_MAX = 300;
export const EVIDENCE_PATH_MAX = 200;

export interface ConventionInput {
  readonly category: string;
  readonly rule: string;
  readonly accepted: boolean;
  readonly evidence_path: string;
  readonly evidence_line_start: number;
}

export interface ConventionView {
  category: string;
  rule: string;
  accepted: boolean;
  /** `path:line` — the snippet is intentionally dropped. */
  evidence: string;
}

export interface ConventionsView {
  scanned_at: string;
  conventions: ConventionView[];
  /** Rules cut by the cap; omitted when nothing was cut. */
  more?: number;
}

/**
 * Optional category filter, accepted rules first (stable, so API order is kept
 * within each group and the cap cuts non-accepted rules first), cap, trim.
 */
export function shapeConventions(
  candidates: readonly ConventionInput[],
  scannedAt: string,
  category?: string,
): ConventionsView {
  const filtered = category === undefined ? [...candidates] : candidates.filter((c) => c.category === category);
  const ordered = [
    ...filtered.filter((c) => c.accepted),
    ...filtered.filter((c) => !c.accepted),
  ];
  const conventions = ordered.slice(0, CONVENTIONS_MAX).map((c) => ({
    category: c.category,
    rule: clipText(c.rule, RULE_MAX),
    accepted: c.accepted,
    evidence: `${clipText(c.evidence_path, EVIDENCE_PATH_MAX)}:${c.evidence_line_start}`,
  }));
  const cut = ordered.length - conventions.length;
  const scanned_at = clipText(scannedAt, 40);
  return cut > 0 ? { scanned_at, conventions, more: cut } : { scanned_at, conventions };
}
