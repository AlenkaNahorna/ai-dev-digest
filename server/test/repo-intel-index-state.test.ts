import { describe, expect, it } from 'vitest';
import { GetIndexState } from '../src/modules/repo-intel/application/use-cases/get-index-state.js';

describe('GetIndexState use-case', () => {
  it('returns persisted state', async () => {
    const state = { repoId: 'r1', status: 'full' as const, filesIndexed: 1, filesSkipped: 0, durationMs: 3, lastIndexedSha: 'sha', indexerVersion: 1, updatedAt: new Date() };
    await expect(new GetIndexState({ tryGetIndexState: async () => state }).execute('r1')).resolves.toBe(state);
  });
  it('returns the stable degraded contract when no state exists', async () => {
    const result = await new GetIndexState({ tryGetIndexState: async () => undefined }).execute('r1');
    expect(result).toMatchObject({ repoId: 'r1', status: 'degraded', degraded: true, degradedReason: 'no_data' });
  });
});
