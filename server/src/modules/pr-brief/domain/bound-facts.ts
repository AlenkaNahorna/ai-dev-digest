import type { BriefMissingInput, SmartDiffRole } from '@devdigest/shared';
import type { BoundedFacts, BriefFacts, BriefFinding, RoleTotals } from './facts.js';
import {
  MAX_CALLER_FILES,
  MAX_DESCRIPTION_CHARS,
  MAX_DOCUMENT_TOKENS,
  MAX_FILES,
  MAX_FINDINGS,
} from './limits.js';

const ROLES: SmartDiffRole[] = ['core', 'tests', 'wiring', 'docs', 'boilerplate'];
const SEVERITY_RANK: Record<BriefFinding['severity'], number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

function emptyRoleTotals(): RoleTotals {
  return Object.fromEntries(ROLES.map((r) => [r, { files: 0, lines: 0 }])) as RoleTotals;
}

/**
 * Pure: apply the input bounds (AC-33) and compute the missing/omitted lists
 * (AC-26, AC-35). Ordering is deterministic (ties broken by path/title) so the
 * same facts always give the same prompt.
 */
export function boundFacts(facts: BriefFacts): BoundedFacts {
  const roleTotals = emptyRoleTotals();
  for (const f of facts.files) {
    roleTotals[f.role].files += 1;
    roleTotals[f.role].lines += f.additions + f.deletions;
  }

  const files = [...facts.files]
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions) || a.path.localeCompare(b.path))
    .slice(0, MAX_FILES);

  const allCallers = [...new Set(facts.blast?.callerFiles ?? [])];
  const callerFiles = allCallers.slice(0, MAX_CALLER_FILES);

  const findings = [...facts.findings]
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        a.file.localeCompare(b.file) ||
        a.line - b.line ||
        a.title.localeCompare(b.title),
    )
    .slice(0, MAX_FINDINGS);

  // Documents are whole or absent: one that does not fit the remaining budget
  // is skipped (never cut) and later, smaller ones may still fit.
  const documents: BoundedFacts['documents'] = [];
  let tokens = 0;
  for (const doc of facts.documents) {
    if (tokens + doc.tokens > MAX_DOCUMENT_TOKENS) continue;
    documents.push(doc);
    tokens += doc.tokens;
  }

  const description =
    facts.description.length > MAX_DESCRIPTION_CHARS ? facts.description.slice(0, MAX_DESCRIPTION_CHARS) : facts.description;

  const missing: BriefMissingInput[] = [];
  if (!facts.intent) missing.push('intent');
  if (!facts.blast) missing.push('blast');
  if (facts.findings.length === 0) missing.push('findings');
  if (facts.documents.length === 0) missing.push('documents');

  const omitted = {
    description: description.length < facts.description.length,
    files: facts.files.length - files.length,
    callers: allCallers.length - callerFiles.length,
    findings: facts.findings.length - findings.length,
    documents: facts.documents.length - documents.length,
  };

  return {
    title: facts.title,
    description,
    files,
    totalFiles: facts.files.length,
    roleTotals,
    callerFiles,
    findings,
    documents,
    intent: facts.intent,
    blast: facts.blast,
    missing,
    omitted,
    partial: omitted.files > 0 || omitted.callers > 0 || omitted.findings > 0 || omitted.documents > 0,
  };
}
