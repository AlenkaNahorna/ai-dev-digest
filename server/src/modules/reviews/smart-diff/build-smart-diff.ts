import type { SmartDiff, SmartDiffFile } from '@devdigest/shared';
import { classifyFile } from './classify-file.js';
import { SMART_DIFF_ROLE_ORDER } from './constants.js';

export interface SmartDiffInputFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface SmartDiffInputFinding {
  file: string;
  start_line: number;
}

export interface SmartDiffInputReview {
  id: string;
  agent_id: string | null;
  created_at: string | Date;
  findings: SmartDiffInputFinding[];
}

const time = (d: string | Date): number => new Date(d).getTime();

/**
 * Findings of the newest review per agent (`agent_id ?? review:<id>`), so that
 * history does not double-count. Same rule as the client `latestReviewsPerAgent`.
 */
export function latestReviewFindings<R extends SmartDiffInputReview>(
  reviews: readonly R[],
): R['findings'] {
  const sorted = [...reviews].sort((a, b) => time(b.created_at) - time(a.created_at));
  const seen = new Set<string>();
  const out: R['findings'] = [];
  for (const r of sorted) {
    const key = r.agent_id ?? `review:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(...r.findings);
  }
  return out;
}

/** Pure: group PR files by role in fixed order, attach finding lines. No I/O. */
export function buildSmartDiff(
  files: readonly SmartDiffInputFile[],
  findings: readonly SmartDiffInputFinding[],
): SmartDiff {
  const linesByFile = new Map<string, Set<number>>();
  for (const f of findings) {
    const set = linesByFile.get(f.file) ?? new Set<number>();
    set.add(f.start_line);
    linesByFile.set(f.file, set);
  }

  const byRole = new Map<string, SmartDiffFile[]>();
  let total = 0;
  for (const f of files) {
    total += f.additions + f.deletions;
    const role = classifyFile(f.path);
    const list = byRole.get(role) ?? [];
    list.push({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      finding_lines: [...(linesByFile.get(f.path) ?? [])].sort((a, b) => a - b),
    });
    byRole.set(role, list);
  }

  return {
    groups: SMART_DIFF_ROLE_ORDER.flatMap((role) => {
      const list = byRole.get(role);
      return list && list.length > 0 ? [{ role, files: list }] : [];
    }),
    split_suggestion: { too_big: false, total_lines: total, proposed_splits: [] },
  };
}
