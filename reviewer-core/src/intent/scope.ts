import type { Finding, Intent } from '@devdigest/shared';

/**
 * Deterministic scope filter applied AFTER grounding.
 *
 * The reviewer tags each finding with `scope` relative to the PR intent. The
 * intent is derived from untrusted PR text, so it must never be able to hide a
 * real defect — the policy below is plain code, not model judgement:
 *  - in_scope / untagged findings are kept;
 *  - out_of_scope + CRITICAL, or category `security`, or kind secret_leak /
 *    lethal_trifecta → PROTECTED, kept unchanged;
 *  - other out_of_scope WARNINGs collapse into ONE `out_of_scope` signal;
 *  - other out_of_scope findings (SUGGESTION) are dropped.
 */

export const OUT_OF_SCOPE_SIGNAL_ID = 'out-of-scope-signal';

export interface ScopeResult {
  kept: Finding[];
  dropped: { finding: Finding; reason: string }[];
  /** The single aggregated signal, when serious out-of-scope findings existed. */
  signal: Finding | null;
}

function isProtected(f: Finding): boolean {
  return (
    f.severity === 'CRITICAL' ||
    f.category === 'security' ||
    f.kind === 'secret_leak' ||
    f.kind === 'lethal_trifecta'
  );
}

export function applyIntentScope(findings: Finding[], intent?: Intent | null): ScopeResult {
  if (!intent) return { kept: findings, dropped: [], signal: null };

  const kept: Finding[] = [];
  const dropped: ScopeResult['dropped'] = [];
  const serious: Finding[] = [];

  for (const f of findings) {
    if (f.scope !== 'out_of_scope' || isProtected(f)) {
      kept.push(f);
    } else if (f.severity === 'WARNING') {
      serious.push(f);
    } else {
      dropped.push({ finding: f, reason: 'out of scope for this PR (low severity)' });
    }
  }

  let signal: Finding | null = null;
  if (serious.length > 0) {
    const top = [...serious].sort((a, b) => b.confidence - a.confidence)[0]!;
    for (const f of serious) {
      if (f !== top) dropped.push({ finding: f, reason: 'folded into the out-of-scope signal' });
    }
    const extra = serious.length - 1;
    signal = {
      id: OUT_OF_SCOPE_SIGNAL_ID,
      severity: 'SUGGESTION',
      category: top.category,
      title: `Out-of-scope issue noted: ${top.title}`,
      file: top.file,
      start_line: top.start_line,
      end_line: top.end_line,
      rationale:
        `This concerns code outside the stated intent of the PR ("${intent.summary}"), so it is not counted as a review finding.` +
        (extra > 0 ? ` ${extra} more out-of-scope observation(s) were omitted.` : '') +
        `\n\n${top.rationale}`,
      suggestion: top.suggestion ?? null,
      confidence: top.confidence,
      kind: 'out_of_scope',
      scope: 'out_of_scope',
    };
    kept.push(signal);
  }

  return { kept, dropped, signal };
}
