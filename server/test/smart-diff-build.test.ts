import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import { buildSmartDiff, latestReviewFindings } from '../src/modules/reviews/smart-diff/build-smart-diff.js';

const files = [
  { path: 'pnpm-lock.yaml', additions: 90, deletions: 20 },
  { path: 'server/src/x.ts', additions: 10, deletions: 2 },
  { path: 'server/src/y.ts', additions: 5, deletions: 0 },
  { path: 'server/src/x.test.ts', additions: 7, deletions: 1 },
  { path: 'server/src/index.ts', additions: 1, deletions: 1 },
  { path: 'README.md', additions: 3, deletions: 0 },
];

describe('buildSmartDiff', () => {
  it('orders the five groups, keeps file order, lock file is boilerplate, contract-valid', () => {
    const d = buildSmartDiff(files, []);
    expect(SmartDiff.parse(d)).toEqual(d);
    expect(d.groups.map((g) => g.role)).toEqual(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
    expect(d.groups[0]!.files.map((f) => f.path)).toEqual(['server/src/x.ts', 'server/src/y.ts']);
    expect(d.groups[4]!.files[0]!.path).toBe('pnpm-lock.yaml');
    expect(d.groups.every((g) => g.files.every((f) => f.finding_lines.length === 0))).toBe(true);
    expect(d.split_suggestion).toEqual({ too_big: false, total_lines: 140, proposed_splits: [] });
  });

  it('omits empty groups', () => {
    const d = buildSmartDiff([{ path: 'a.ts', additions: 1, deletions: 0 }], []);
    expect(d.groups.map((g) => g.role)).toEqual(['core']);
  });

  it('dedupes/sorts finding_lines and ignores files outside the PR', () => {
    const d = buildSmartDiff(files, [
      { file: 'server/src/x.ts', start_line: 30 },
      { file: 'server/src/x.ts', start_line: 12 },
      { file: 'server/src/x.ts', start_line: 12 },
      { file: 'nope.ts', start_line: 1 },
    ]);
    expect(d.groups[0]!.files[0]!.finding_lines).toEqual([12, 30]);
    expect(JSON.stringify(d)).not.toContain('nope.ts');
  });
});

describe('latestReviewFindings', () => {
  const f = (n: number) => ({ file: 'a.ts', start_line: n });
  it('keeps only the newest review per agent', () => {
    const out = latestReviewFindings([
      { id: 'r1', agent_id: 'A', created_at: '2026-01-01T00:00:00Z', findings: [f(1)] },
      { id: 'r2', agent_id: 'A', created_at: '2026-01-02T00:00:00Z', findings: [f(2)] },
      { id: 'r3', agent_id: 'B', created_at: '2026-01-01T00:00:00Z', findings: [f(3)] },
      { id: 'r4', agent_id: null, created_at: '2026-01-01T00:00:00Z', findings: [f(4)] },
    ]);
    expect(out.map((x) => x.start_line).sort()).toEqual([2, 3, 4]);
  });
});
