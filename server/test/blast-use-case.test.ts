import { describe, it, expect, vi } from 'vitest';
import { createGetBlastRadius } from '../src/modules/blast/application/use-cases/get-blast-radius.js';
import type { BlastResult } from '../src/modules/repo-intel/types.js';

const result = (over: Partial<BlastResult> = {}): BlastResult => ({
  changedSymbols: [{ name: 'a', file: 'a.ts', kind: 'function' }],
  callers: [{ file: 'b.ts', symbol: 'caller', viaSymbol: 'a', line: 4, rank: 1 }],
  impactedEndpoints: [],
  ...over,
});

function setup(pull: { repoId: string; changedFiles: string[] } | undefined, facade: BlastResult = result()) {
  const resolvePullFiles = vi.fn(async () => pull);
  const getBlastRadius = vi.fn(async () => facade);
  const run = createGetBlastRadius({ files: { resolvePullFiles }, intel: { getBlastRadius } });
  return { run, resolvePullFiles, getBlastRadius };
}

describe('getBlastRadius use case', () => {
  it('returns undefined and skips the facade when the pull is not in the workspace', async () => {
    const { run, resolvePullFiles, getBlastRadius } = setup(undefined);
    expect(await run('ws', 'pr')).toBeUndefined();
    expect(resolvePullFiles).toHaveBeenCalledWith('ws', 'pr');
    expect(getBlastRadius).not.toHaveBeenCalled();
  });

  it('returns degraded no_data without calling the facade when there are no files', async () => {
    const { run, getBlastRadius } = setup({ repoId: 'r', changedFiles: [] });
    expect(await run('ws', 'pr')).toEqual({
      changed_symbols: [],
      downstream: [],
      summary: '0 symbols · 0 callers · 0 endpoints · 0 crons',
      degraded: true,
      degraded_reason: 'no_data',
    });
    expect(getBlastRadius).not.toHaveBeenCalled();
  });

  it('calls the facade once with the repo and changed files and maps the result', async () => {
    const { run, getBlastRadius } = setup({ repoId: 'r1', changedFiles: ['a.ts', 'c.ts'] });
    const out = await run('ws', 'pr');
    expect(getBlastRadius).toHaveBeenCalledTimes(1);
    expect(getBlastRadius).toHaveBeenCalledWith('r1', ['a.ts', 'c.ts']);
    expect(out?.downstream[0]?.callers).toEqual([{ name: 'caller', file: 'b.ts', line: 4 }]);
    expect(out?.degraded).toBe(false);
  });

  it('passes facade degradation through together with the data', async () => {
    const { run } = setup({ repoId: 'r', changedFiles: ['a.ts'] }, result({ degraded: true, reason: 'no_data' }));
    const out = await run('ws', 'pr');
    expect(out?.degraded).toBe(true);
    expect(out?.degraded_reason).toBe('no_data');
    expect(out?.downstream).toHaveLength(1);
  });
});
