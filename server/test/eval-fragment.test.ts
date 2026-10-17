import { describe, it, expect } from 'vitest';
import { groundFindings } from '@devdigest/reviewer-core';
import { extractFileFragment } from '../src/modules/eval-pipeline/domain/fragment.js';
import { slugify, uniqueCaseName } from '../src/modules/eval-pipeline/domain/case-name.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { PR_DIFF } from './helpers/eval-fakes.js';

describe('extractFileFragment (AC-4)', () => {
  it('keeps only the file and the hunk that intersects the lines', () => {
    const frag = extractFileFragment(PR_DIFF, 'src/api/webhooks.ts', 60, 61)!;
    expect(frag).toContain('diff --git a/src/api/webhooks.ts');
    expect(frag).toContain('@@ -58,6 +59,8 @@');
    expect(frag).not.toContain('@@ -1,3 +1,4 @@');
    expect(frag).not.toContain('src/config.ts');
  });
  it('falls back to the whole file diff when no hunk intersects', () => {
    const frag = extractFileFragment(PR_DIFF, 'src/api/webhooks.ts', 500, 501)!;
    expect(frag).toContain('@@ -1,3 +1,4 @@');
    expect(frag).toContain('@@ -58,6 +59,8 @@');
  });
  it('returns undefined when the file is not in the diff', () => {
    expect(extractFileFragment(PR_DIFF, 'src/missing.ts', 1, 1)).toBeUndefined();
  });
  it('accepts a ./ or b/ prefixed path', () => {
    expect(extractFileFragment(PR_DIFF, './src/config.ts', 12, 12)).toBeDefined();
  });
  it('the fragment still grounds the same lines the finding cited', () => {
    const frag = extractFileFragment(PR_DIFF, 'src/config.ts', 12, 12)!;
    const diff = parseUnifiedDiff(frag);
    expect(diff.files.map((f) => f.path)).toEqual(['src/config.ts']);
    const finding = { id: 'f', severity: 'CRITICAL', category: 'security', title: 't', file: 'src/config.ts', start_line: 12, end_line: 12, rationale: 'r', confidence: 0.9 } as never;
    expect(groundFindings([finding], diff).kept).toHaveLength(1);
  });
});

describe('case names', () => {
  it('slugifies titles', () => {
    expect(slugify('Hardcoded Stripe secret key!')).toBe('hardcoded-stripe-secret-key');
    expect(slugify('!!!')).toBe('case');
  });
  it('stays unique among taken names', () => {
    const taken = new Set(['same']);
    expect(uniqueCaseName('same', 7, taken)).toBe('same-l7');
    taken.add('same-l7');
    expect(uniqueCaseName('same', 7, taken)).toBe('same-l7-2');
  });
});
