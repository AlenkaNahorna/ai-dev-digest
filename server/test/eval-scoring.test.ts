import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregate, isHit, normalizePath, rangesIntersect, scoreCase } from '../src/modules/eval-pipeline/domain/scoring.js';

const mustFind = { kind: 'must_find' as const, file: 'src/config.ts', startLine: 10, endLine: 14 };
const mustNot = { kind: 'must_not_flag' as const, file: 'src/config.ts', startLine: 10, endLine: 14 };
const at = (file: string, s: number, e = s) => ({ file, startLine: s, endLine: e });

describe('eval scoring: matching (AC-23)', () => {
  it('normalizes ./, a/, b/ and backslashes', () => {
    expect(normalizePath('./src/x.ts')).toBe('src/x.ts');
    expect(normalizePath('b/src/x.ts')).toBe('src/x.ts');
    expect(normalizePath('src\\x.ts')).toBe('src/x.ts');
  });
  it('intersects inclusive ranges, in either order', () => {
    expect(rangesIntersect(1, 5, 5, 9)).toBe(true);
    expect(rangesIntersect(1, 4, 5, 9)).toBe(false);
    expect(rangesIntersect(9, 5, 1, 5)).toBe(true);
  });
  it('requires the same file AND overlapping lines', () => {
    expect(isHit(at('b/src/config.ts', 12), mustFind)).toBe(true);
    expect(isHit(at('src/other.ts', 12), mustFind)).toBe(false);
    expect(isHit(at('src/config.ts', 15), mustFind)).toBe(false);
  });
});

describe('eval scoring: cases (AC-24, AC-25)', () => {
  it('must_find passes on a hit, fails without one', () => {
    expect(scoreCase({ expectation: mustFind, kept: [at('src/config.ts', 12)], droppedCount: 0 }).pass).toBe(true);
    expect(scoreCase({ expectation: mustFind, kept: [at('src/config.ts', 99)], droppedCount: 0 }).pass).toBe(false);
    expect(scoreCase({ expectation: mustFind, kept: [], droppedCount: 0 }).pass).toBe(false);
  });
  it('must_not_flag fails on a hit and counts it as noise', () => {
    const s = scoreCase({ expectation: mustNot, kept: [at('src/config.ts', 11), at('src/config.ts', 13)], droppedCount: 1 });
    expect(s.pass).toBe(false);
    expect(s.noise).toBe(2);
    expect(s.emitted).toBe(3);
    expect(scoreCase({ expectation: mustNot, kept: [], droppedCount: 0 }).pass).toBe(true);
  });
  it('an errored case is a failure with no counts', () => {
    const s = scoreCase({ expectation: mustFind, kept: [], droppedCount: 0, errored: true });
    expect(s.pass).toBe(false);
    expect(s.errored).toBe(true);
    expect(s.emitted).toBe(0);
  });
});

describe('eval scoring: aggregate (AC-26..AC-28)', () => {
  it('computes recall, precision and citation accuracy', () => {
    const scores = [
      scoreCase({ expectation: mustFind, kept: [at('src/config.ts', 12)], droppedCount: 1 }), // pass, kept 1, emitted 2
      scoreCase({ expectation: mustFind, kept: [], droppedCount: 0 }), // miss
      scoreCase({ expectation: mustNot, kept: [at('src/config.ts', 11)], droppedCount: 0 }), // noise 1, kept 1
      scoreCase({ expectation: mustNot, kept: [], droppedCount: 0 }),
    ];
    const m = aggregate(scores);
    expect(m.recall).toBeCloseTo(0.5, 10);
    expect(m.precision).toBeCloseTo(0.5, 10); // (2 kept - 1 noise) / 2
    expect(m.citation_accuracy).toBeCloseTo(2 / 3, 10); // 2 kept / 3 emitted
  });
  it('returns null when a denominator is zero (AC-29)', () => {
    const m = aggregate([scoreCase({ expectation: mustNot, kept: [], droppedCount: 0 })]);
    expect(m.recall).toBeNull();
    expect(m.precision).toBeNull();
    expect(m.citation_accuracy).toBeNull();
  });
  it('errored cases miss recall but stay out of precision and citation', () => {
    const m = aggregate([
      scoreCase({ expectation: mustFind, kept: [at('src/config.ts', 12)], droppedCount: 0 }),
      scoreCase({ expectation: mustFind, kept: [], droppedCount: 0, errored: true }),
    ]);
    expect(m.recall).toBeCloseTo(0.5, 10);
    expect(m.precision).toBe(1);
    expect(m.citation_accuracy).toBe(1);
  });
});

describe('eval scoring: no model in the scoring path (AC-22)', () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/modules/eval-pipeline/domain');
  const forbidden = /(openai|anthropic|openrouter|reviewer-core|\/llm\/|\/adapters\/|\/platform\/|\/db\/|drizzle|fetch\(|node:http|node:https)/i;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    it(`domain/${file} imports nothing outward`, () => {
      const imports = readFileSync(path.join(dir, file), 'utf8').split('\n').filter((l) => /^\s*(import|export)\b.*\bfrom\b/.test(l) || /\bfetch\(/.test(l));
      expect(imports.filter((l) => forbidden.test(l))).toHaveLength(0);
    });
  }
});
