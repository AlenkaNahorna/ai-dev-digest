/**
 * GET /pulls/:id/blast — maps repo-intel blast data onto the BlastRadius
 * contract. Pure read: no LLM call. Gated on Docker like the other integration tests.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { BlastRadius } from '@devdigest/shared';
import type { BlastResult, RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;
async function setupPr(db: PgFixture['handle']['db'], workspaceId: string, files: string[]) {
  const name = `blast-${seq++}`;
  const [repo] = await db.insert(t.repos).values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` }).returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId, repoId: repo!.id, number: 1, title: 'x', author: 'a', branch: 'b', base: 'main',
      headSha: 'abc', additions: 1, deletions: 0, filesCount: files.length, status: 'open',
    })
    .returning();
  if (files.length) await db.insert(t.prFiles).values(files.map((path) => ({ prId: pr!.id, path, additions: 1, deletions: 0 })));
  return { pr: pr!, repoId: repo!.id };
}

d('blast route (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  const llm = new MockLLMProvider('openai');
  const facade: BlastResult = {
    changedSymbols: [{ name: 'a', file: 'src/a.ts', kind: 'function' }],
    callers: [{ file: 'src/b.ts', symbol: 'caller', viaSymbol: 'a', line: 7, rank: 1 }],
    impactedEndpoints: [],
    factsByFile: { 'src/b.ts': { endpoints: ['GET /x'], crons: [] } },
  };
  const getBlastRadius = vi.fn(async (_repoId: string, _files: string[]): Promise<BlastResult> => facade);
  const repoIntel = { getBlastRadius } as unknown as RepoIntel;

  const app = () => buildApp({ config: config(), db: pg.handle.db, overrides: { llm: { openai: llm }, repoIntel } });

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('returns a contract-valid blast radius and never calls the LLM', async () => {
    const { pr, repoId } = await setupPr(pg.handle.db, workspaceId, ['src/a.ts', 'README.md']);
    getBlastRadius.mockClear();
    const a = await app();
    const res = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = BlastRadius.parse(res.json());
    expect(body.downstream[0]!.callers).toEqual([{ name: 'caller', file: 'src/b.ts', line: 7 }]);
    expect(body.downstream[0]!.endpoints_affected).toEqual(['GET /x']);
    expect(getBlastRadius).toHaveBeenCalledTimes(1);
    expect(getBlastRadius.mock.calls[0]![0]).toBe(repoId);
    expect([...getBlastRadius.mock.calls[0]![1]].sort()).toEqual(['README.md', 'src/a.ts']);
    expect(llm.calls).toHaveLength(0);
    await a.close();
  });

  it('404 for an unknown pull id', async () => {
    const a = await app();
    const res = await a.inject({ method: 'GET', url: '/pulls/00000000-0000-4000-8000-000000000000/blast' });
    expect(res.statusCode).toBe(404);
    await a.close();
  });

  it('404 for a pull request of another workspace', async () => {
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'other' }).returning();
    const { pr } = await setupPr(pg.handle.db, other!.id, ['src/a.ts']);
    getBlastRadius.mockClear();
    const a = await app();
    const res = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(404);
    expect(getBlastRadius).not.toHaveBeenCalled();
    await a.close();
  });

  it('passes the degraded flag and reason through with 200', async () => {
    const { pr } = await setupPr(pg.handle.db, workspaceId, ['src/a.ts']);
    getBlastRadius.mockResolvedValueOnce({ ...facade, degraded: true, reason: 'no_data' });
    const a = await app();
    const res = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = BlastRadius.parse(res.json());
    expect(body.degraded).toBe(true);
    expect(body.degraded_reason).toBe('no_data');
    expect(body.downstream).toHaveLength(1);
    await a.close();
  });

  it('degraded no_data without calling the facade when the pull has no stored files', async () => {
    const { pr } = await setupPr(pg.handle.db, workspaceId, []);
    getBlastRadius.mockClear();
    const a = await app();
    const res = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    expect(BlastRadius.parse(res.json()).degraded_reason).toBe('no_data');
    expect(getBlastRadius).not.toHaveBeenCalled();
    await a.close();
  });
});
