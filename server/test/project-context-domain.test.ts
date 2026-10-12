import { describe, it, expect } from 'vitest';
import { effectiveSet, agentsPerPath } from '../src/modules/project-context/domain/effective-set.js';
import { docTypeOf } from '../src/modules/project-context/domain/doc-type.js';
import { findRoot, isDiscoverablePath } from '../src/modules/project-context/domain/root-match.js';
import { unusableReason } from '../src/modules/project-context/domain/doc-text.js';

const ROOTS = ['specs', 'docs', 'insights'];

describe('effectiveSet (AC-23)', () => {
  it('puts agent docs first in agent order, then skills by skill order then doc order', () => {
    const out = effectiveSet(
      [
        { path: 'specs/b.md', order: 1 },
        { path: 'specs/a.md', order: 0 },
      ],
      [
        { skillOrder: 1, docs: [{ path: 'docs/z.md', order: 0 }] },
        {
          skillOrder: 0,
          docs: [
            { path: 'docs/y.md', order: 1 },
            { path: 'docs/x.md', order: 0 },
          ],
        },
      ],
    );
    expect(out).toEqual(['specs/a.md', 'specs/b.md', 'docs/x.md', 'docs/y.md', 'docs/z.md']);
  });

  it('keeps only the first occurrence of a path across agent and skills', () => {
    const out = effectiveSet(
      [{ path: 'specs/a.md', order: 0 }],
      [
        { skillOrder: 0, docs: [{ path: 'specs/a.md', order: 0 }, { path: 'docs/b.md', order: 1 }] },
        { skillOrder: 1, docs: [{ path: 'docs/b.md', order: 0 }, { path: 'docs/c.md', order: 1 }] },
      ],
    );
    expect(out).toEqual(['specs/a.md', 'docs/b.md', 'docs/c.md']);
  });

  it('is empty without attachments and does not mutate its inputs', () => {
    expect(effectiveSet([], [])).toEqual([]);
    const agent = [
      { path: 'b.md', order: 1 },
      { path: 'a.md', order: 0 },
    ];
    effectiveSet(agent, []);
    expect(agent.map((d) => d.path)).toEqual(['b.md', 'a.md']);
  });
});

describe('agentsPerPath ("Used by N agents")', () => {
  it('counts distinct agents across direct and skill-inherited rows', () => {
    const counts = agentsPerPath(
      [
        { agentId: 'a1', path: 'specs/a.md' },
        { agentId: 'a2', path: 'specs/a.md' },
      ],
      [
        { agentId: 'a1', path: 'specs/a.md' }, // same agent via a skill: counted once
        { agentId: 'a3', path: 'specs/a.md' },
        { agentId: 'a3', path: 'docs/b.md' },
      ],
    );
    expect(counts.get('specs/a.md')).toBe(3);
    expect(counts.get('docs/b.md')).toBe(1);
    expect(counts.get('docs/none.md')).toBeUndefined();
  });
});

describe('root matching and document type (AC-1, AC-2, AC-5)', () => {
  it('matches a root folder at any depth and reports the outermost root as the type', () => {
    expect(findRoot('specs/a.md', ROOTS)).toBe('specs');
    expect(findRoot('server/docs/architecture.md', ROOTS)).toBe('docs');
    expect(docTypeOf('docs/specs/nested.md', ROOTS)).toBe('docs');
    expect(docTypeOf('insights/x/y/z.md', ROOTS)).toBe('insights');
  });

  it('does not match files outside a root, the file name itself, or non-markdown', () => {
    expect(findRoot('README.md', ROOTS)).toBeUndefined();
    expect(findRoot('src/docs.md', ROOTS)).toBeUndefined();
    expect(docTypeOf('src/a.md', ROOTS)).toBeNull();
    expect(isDiscoverablePath('docs/a.txt', ROOTS)).toBe(false);
    expect(isDiscoverablePath('docs/A.MD', ROOTS)).toBe(true);
  });

  it('excludes third-party and generated trees even under a root name', () => {
    for (const p of [
      'node_modules/pkg/docs/readme.md',
      '.pnpm-store/v3/docs/a.md',
      'docs/vendor/lib/a.md',
      'dist/docs/a.md',
      'client/.next/docs/a.md',
    ]) {
      expect(isDiscoverablePath(p, ROOTS), p).toBe(false);
    }
  });

  it('honours configured roots instead of the default (AC-3)', () => {
    expect(isDiscoverablePath('adr/0001.md', ['adr'])).toBe(true);
    expect(isDiscoverablePath('specs/a.md', ['adr'])).toBe(false);
  });

  it('keeps long and non-ASCII paths unchanged', () => {
    const p = 'docs/Spezifikationen/Überblick – Größe 日本語.md';
    expect(isDiscoverablePath(p, ROOTS)).toBe(true);
    expect(docTypeOf(p, ROOTS)).toBe('docs');
  });
});

describe('unusableReason (AC-34)', () => {
  it('flags empty/whitespace and non-UTF-8 (replacement char or NUL) text', () => {
    expect(unusableReason('')).toBe('empty');
    expect(unusableReason(' \n\t ')).toBe('empty');
    expect(unusableReason('bad � bytes')).toBe('non_utf8');
    expect(unusableReason('bin\0ary')).toBe('non_utf8');
    expect(unusableReason('# Title\nbody')).toBeUndefined();
  });
});

describe('findRoot with the * wildcard', () => {
  it('matches every folder and types by top-level folder', async () => {
    const { findRoot, isDiscoverablePath } = await import('../src/modules/project-context/domain/root-match.js');
    expect(findRoot('README.md', ['*'])).toBe('root');
    expect(findRoot('server/src/prompts/a.md', ['*'])).toBe('server');
    expect(findRoot('node_modules/x/a.md', ['*'])).toBeUndefined();
    expect(isDiscoverablePath('client/README.md', ['*'])).toBe(true);
  });
});
