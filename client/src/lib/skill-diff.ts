export type SkillDiffLine = { kind: "context" | "added" | "removed"; line: string };
export const MAX_DIFF_LINES = 2000;
export const MAX_DIFF_CELLS = 1_000_000;

/** Deterministic line diff used for immutable skill version snapshots. */
export function buildSkillDiff(before: string, after: string): SkillDiffLine[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES || a.length * b.length > MAX_DIFF_CELLS) {
    return [{ kind: "context", line: "Diff is too large to render safely. Compare these versions outside the browser." }];
  }
  const dp = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  }
  const rows: SkillDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) rows.push({ kind: "context", line: a[i]! }), i += 1, j += 1;
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) rows.push({ kind: "removed", line: a[i++]! });
    else rows.push({ kind: "added", line: b[j++]! });
  }
  while (i < a.length) rows.push({ kind: "removed", line: a[i++]! });
  while (j < b.length) rows.push({ kind: "added", line: b[j++]! });
  return rows;
}
