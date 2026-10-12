import type { PrBrief, Risk } from '@devdigest/shared';
import type { BoundedFacts } from './facts.js';
import {
  MAX_FOCUS_ITEMS,
  MAX_FOCUS_REASON_CHARS,
  MAX_RISKS,
  MAX_RISK_EXPLANATION_CHARS,
  MAX_RISK_FILE_REFS,
  MAX_RISK_KIND_CHARS,
  MAX_RISK_TITLE_CHARS,
  MAX_SUMMARY_CHARS,
} from './limits.js';
import type { ModelBriefOutput } from './model-output.js';

const cut = (text: string, max: number): string => {
  const t = text.trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
};

/**
 * Pure: turn the (already schema-validated, still untrusted) model answer into
 * the stored brief. Drops what is not grounded in the provided facts (AC-20,
 * AC-20a, AC-21), cuts lists and text to the AC-34 bounds instead of failing,
 * keeps the model's order, and records missing/partial (AC-27, AC-35).
 *
 * `facts` must be the bounded facts the model actually saw, and `changedFiles`
 * the paths of `facts.files` (the files shown to it, not every gathered file):
 * only those and the caller files shown to it are valid references.
 */
export function normalizeBrief(output: ModelBriefOutput, facts: BoundedFacts, changedFiles: readonly string[]): PrBrief {
  const changed = new Set(changedFiles);
  const refs = new Set<string>([...changed, ...facts.callerFiles]);

  const linesByFile = new Map<string, Set<number>>();
  for (const f of facts.findings) {
    const set = linesByFile.get(f.file) ?? new Set<number>();
    set.add(f.line);
    linesByFile.set(f.file, set);
  }

  const risks: Risk[] = [];
  for (const r of output.risks) {
    const file_refs = [...new Set(r.file_refs.filter((p) => refs.has(p)))].slice(0, MAX_RISK_FILE_REFS);
    if (file_refs.length === 0) continue;
    const title = cut(r.title, MAX_RISK_TITLE_CHARS);
    if (title.length === 0) continue;
    risks.push({
      kind: cut(r.kind, MAX_RISK_KIND_CHARS),
      title,
      explanation: cut(r.explanation, MAX_RISK_EXPLANATION_CHARS),
      severity: r.severity,
      file_refs,
    });
    if (risks.length === MAX_RISKS) break;
  }

  const review_focus: PrBrief['review_focus'] = [];
  for (const item of output.review_focus) {
    if (!changed.has(item.file)) continue;
    const reason = cut(item.reason, MAX_FOCUS_REASON_CHARS);
    if (reason.length === 0) continue;
    const line = item.line != null && linesByFile.get(item.file)?.has(item.line) ? item.line : null;
    review_focus.push({ file: item.file, line, reason });
    if (review_focus.length === MAX_FOCUS_ITEMS) break;
  }

  return {
    summary: cut(output.summary, MAX_SUMMARY_CHARS),
    risks: { risks },
    review_focus,
    missing_inputs: facts.missing,
    partial: facts.partial,
  };
}
