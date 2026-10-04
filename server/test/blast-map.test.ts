import { describe, it, expect } from 'vitest';
import { BlastRadius } from '@devdigest/shared';
import { mapBlast } from '../src/modules/blast/domain/map-blast.js';
import type { BlastResult } from '../src/modules/repo-intel/types.js';

const base = (over: Partial<BlastResult> = {}): BlastResult => ({
  changedSymbols: [
    { name: 'a', file: 'src/a.ts', kind: 'function' },
    { name: 'b', file: 'src/b.ts', kind: 'class' },
    { name: 'lonely', file: 'src/l.ts', kind: 'function' },
  ],
  callers: [],
  impactedEndpoints: [],
  ...over,
});

describe('mapBlast', () => {
  it('groups callers by viaSymbol in changed_symbols order; symbols without callers only stay in changed_symbols', () => {
    const out = mapBlast(
      base({
        callers: [
          { file: 'x.ts', symbol: 'fromB', viaSymbol: 'b', line: 3, rank: 1 },
          { file: 'y.ts', symbol: 'fromA', viaSymbol: 'a', line: 9, rank: 1 },
        ],
      }),
    );
    expect(out.downstream.map((d) => d.symbol)).toEqual(['a', 'b']);
    expect(out.changed_symbols.map((s) => s.name)).toEqual(['a', 'b', 'lonely']);
    expect(out.downstream.map((d) => d.symbol)).not.toContain('lonely');
  });

  it('puts unknown viaSymbols last, alphabetically', () => {
    const out = mapBlast(
      base({
        callers: [
          { file: 'x.ts', symbol: 's', viaSymbol: 'zzz', line: 1, rank: 0 },
          { file: 'x.ts', symbol: 's', viaSymbol: 'mmm', line: 1, rank: 0 },
          { file: 'x.ts', symbol: 's', viaSymbol: 'a', line: 1, rank: 0 },
        ],
      }),
    );
    expect(out.downstream.map((d) => d.symbol)).toEqual(['a', 'mmm', 'zzz']);
  });

  it('sorts callers by rank desc, file, line and dedupes', () => {
    const out = mapBlast(
      base({
        callers: [
          { file: 'b.ts', symbol: 'f', viaSymbol: 'a', line: 2, rank: 1 },
          { file: 'a.ts', symbol: 'f', viaSymbol: 'a', line: 5, rank: 1 },
          { file: 'a.ts', symbol: 'f', viaSymbol: 'a', line: 1, rank: 1 },
          { file: 'a.ts', symbol: 'f', viaSymbol: 'a', line: 1, rank: 1 },
          { file: 'z.ts', symbol: 'top', viaSymbol: 'a', line: 1, rank: 5 },
        ],
      }),
    );
    expect(out.downstream[0]!.callers.map((c) => `${c.file}:${c.line}`)).toEqual(['z.ts:1', 'a.ts:1', 'a.ts:5', 'b.ts:2']);
  });

  it('dedupes changed symbols by name and file', () => {
    const out = mapBlast(base({ changedSymbols: [{ name: 'a', file: 'x.ts', kind: 'function' }, { name: 'a', file: 'x.ts', kind: 'function' }] }));
    expect(out.changed_symbols).toHaveLength(1);
  });

  it('derives endpoints and crons per group from factsByFile and counts them once in the summary', () => {
    const out = mapBlast(
      base({
        callers: [
          { file: 'r1.ts', symbol: 'h1', viaSymbol: 'a', line: 1, rank: 1 },
          { file: 'r2.ts', symbol: 'h2', viaSymbol: 'b', line: 1, rank: 1 },
        ],
        impactedEndpoints: ['GET /ignored'],
        factsByFile: {
          'r1.ts': { endpoints: ['POST /x', 'GET /y'], crons: ['nightly'] },
          'r2.ts': { endpoints: ['GET /y'], crons: [] },
        },
      }),
    );
    expect(out.downstream[0]!.endpoints_affected).toEqual(['GET /y', 'POST /x']);
    expect(out.downstream[0]!.crons_affected).toEqual(['nightly']);
    expect(out.downstream[1]!.endpoints_affected).toEqual(['GET /y']);
    expect(out.summary).toBe('3 symbols · 2 callers · 2 endpoints · 1 crons');
  });

  it('returns empty endpoint/cron arrays when factsByFile is absent', () => {
    const out = mapBlast(base({ callers: [{ file: 'r1.ts', symbol: 'h', viaSymbol: 'a', line: 1, rank: 0 }], impactedEndpoints: ['GET /z'] }));
    expect(out.downstream[0]!.endpoints_affected).toEqual([]);
    expect(out.downstream[0]!.crons_affected).toEqual([]);
    expect(out.summary).toContain('0 endpoints');
  });

  it('maps degraded and reason, omitting the reason when not degraded', () => {
    const ok = mapBlast(base());
    expect(ok.degraded).toBe(false);
    expect(ok.degraded_reason).toBeUndefined();
    const bad = mapBlast(base({ degraded: true, reason: 'no_data' }));
    expect(bad.degraded).toBe(true);
    expect(bad.degraded_reason).toBe('no_data');
    expect(mapBlast(base({ degraded: false, reason: 'no_data' })).degraded_reason).toBeUndefined();
  });

  it('produces a contract-valid result', () => {
    const out = mapBlast(base({ callers: [{ file: 'x.ts', symbol: 's', viaSymbol: 'a', line: 1, rank: 0 }], degraded: true, reason: 'index_failed' }));
    expect(() => BlastRadius.parse(out)).not.toThrow();
  });
});
