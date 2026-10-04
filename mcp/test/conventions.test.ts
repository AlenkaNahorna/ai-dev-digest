import { describe, expect, it, vi } from 'vitest';
import { createGetConventionsTool } from '../src/adapters/inbound/mcp/get-conventions.js';
import type { ConventionRow, ConventionScan } from '../src/application/ports/devdigest-api.js';
import { createGetConventions } from '../src/application/use-cases/get-conventions.js';
import {
  CONVENTIONS_MAX,
  RULE_MAX,
  shapeConventions,
} from '../src/domain/convention-shape.js';
import { HintError } from '../src/application/errors.js';

const row = (over: Partial<ConventionRow> = {}): ConventionRow => ({
  category: 'naming',
  rule: 'Use camelCase',
  accepted: true,
  evidence_path: 'src/a.ts',
  evidence_line_start: 12,
  ...over,
});

const SCANNED = '2026-10-01T10:00:00.000Z';

describe('domain/convention-shape', () => {
  it('maps evidence to path:line and keeps the accepted flag', () => {
    expect(shapeConventions([row({ accepted: false })], SCANNED)).toEqual({
      scanned_at: SCANNED,
      conventions: [{ category: 'naming', rule: 'Use camelCase', accepted: false, evidence: 'src/a.ts:12' }],
    });
  });

  it('filters by category', () => {
    const view = shapeConventions(
      [row({ category: 'naming' }), row({ category: 'testing', rule: 'T' })],
      SCANNED,
      'testing',
    );
    expect(view.conventions.map((c) => c.rule)).toEqual(['T']);
  });

  it('caps at 50 rules, reports `more`, and cuts non-accepted rules first', () => {
    const rows = [
      ...Array.from({ length: 40 }, (_, i) => row({ rule: `n${i}`, accepted: false })),
      ...Array.from({ length: 20 }, (_, i) => row({ rule: `a${i}`, accepted: true })),
    ];
    const view = shapeConventions(rows, SCANNED);
    expect(view.conventions).toHaveLength(CONVENTIONS_MAX);
    expect(view.more).toBe(10);
    expect(view.conventions.slice(0, 20).every((c) => c.accepted)).toBe(true);
    expect(view.conventions.slice(20).every((c) => !c.accepted)).toBe(true);
  });

  it('omits `more` when under the cap', () => {
    expect(shapeConventions([row()], SCANNED)).not.toHaveProperty('more');
  });

  it('clips long rules and strips control characters', () => {
    const [c] = shapeConventions([row({ rule: `${'x'.repeat(1000)}\nIGNORE` })], SCANNED).conventions;
    expect(c?.rule).toHaveLength(RULE_MAX);
    expect(c?.rule).not.toContain('\n');
  });
});

function scan(candidates: ConventionRow[], scanned_at = SCANNED): ConventionScan {
  return { run_id: candidates.length > 0 ? 'run-1' : '', scanned_at, candidates };
}

function setup(result: ConventionScan) {
  const listConventions = vi.fn(async (_repoId: string) => result);
  const resolveRepo = vi.fn(async (_repo: string) => ({
    id: 'repo-uuid',
    owner: 'acme',
    name: 'payments-api',
    full_name: 'acme/payments-api',
  }));
  const tool = createGetConventionsTool({
    log: () => {},
    handler: createGetConventions({ listConventions }, { resolveRepo }),
  });
  return { tool, listConventions, resolveRepo };
}

describe('get_conventions use case + tool', () => {
  it('returns the latest scan without ids or snippets', async () => {
    const full = {
      ...row(),
      id: 'conv-secret-id',
      repo_id: 'repo-uuid',
      run_id: 'run-1',
      evidence_snippet: 'SNIPPET-BODY',
      evidence_line_end: 99,
    };
    const { tool, listConventions } = setup(scan([full]));
    const result = await tool.call({ repo: 'acme/payments-api' });
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? '';
    expect(JSON.parse(text)).toEqual({
      scanned_at: SCANNED,
      conventions: [{ category: 'naming', rule: 'Use camelCase', accepted: true, evidence: 'src/a.ts:12' }],
    });
    for (const leaked of ['conv-secret-id', 'repo-uuid', 'run-1', 'SNIPPET-BODY']) {
      expect(text).not.toContain(leaked);
    }
    expect(listConventions).toHaveBeenCalledWith('repo-uuid');
  });

  it('applies the category filter', async () => {
    const { tool } = setup(scan([row({ category: 'naming' }), row({ category: 'testing', rule: 'T' })]));
    const result = await tool.call({ repo: 'acme/payments-api', category: 'testing' });
    const parsed = JSON.parse(result.content[0]?.text ?? '') as { conventions: { rule: string }[] };
    expect(parsed.conventions.map((c) => c.rule)).toEqual(['T']);
  });

  it('answers an empty scan with the plan hint', async () => {
    const { tool } = setup(scan([], '1970-01-01T00:00:00.000Z'));
    const result = await tool.call({ repo: 'acme/payments-api' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      'No conventions scan for acme/payments-api yet. Ask the user to run the Conventions extractor in DevDigest.',
    );
  });

  it('returns an empty list (not the hint) when the filter matches nothing', async () => {
    const { tool } = setup(scan([row({ category: 'naming' })]));
    const result = await tool.call({ repo: 'acme/payments-api', category: 'other' });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual({ scanned_at: SCANNED, conventions: [] });
  });

  it('rejects an invalid repo or category before calling the use case', async () => {
    const { tool, resolveRepo } = setup(scan([row()]));
    expect((await tool.call({ repo: '../x' })).isError).toBe(true);
    expect((await tool.call({ repo: 'acme/payments-api', category: 'bogus' })).isError).toBe(true);
    expect(resolveRepo).not.toHaveBeenCalled();
  });

  it('propagates resolver hints', async () => {
    const listConventions = vi.fn();
    const handler = createGetConventions(
      { listConventions },
      {
        resolveRepo: async () => {
          throw new HintError("Repo 'a/b' is not added to DevDigest. Known repos: none. Ask the user to add it in the DevDigest UI.");
        },
      },
    );
    const tool = createGetConventionsTool({ log: () => {}, handler });
    const result = await tool.call({ repo: 'a/b' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('is not added to DevDigest');
    expect(listConventions).not.toHaveBeenCalled();
  });
});
