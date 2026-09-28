/**
 * GET /pulls/:id/smart-diff — files grouped by role + finding lines. Pure DB
 * read: no LLM call. Gated on Docker like the other integration tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { SmartDiff } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const FILES = ['pnpm-lock.yaml', 'server/src/x.ts', 'server/src/x.test.ts', 'server/src/index.ts', 'README.md'];

let seq = 0;
async function setupPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `smart-${seq++}`;
  const [repo] = await db.insert(t.repos).values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` }).returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId, repoId: repo!.id, number: 1, title: 'x', author: 'a', branch: 'b', base: 'main',
      headSha: 'abc', additions: 1, deletions: 0, filesCount: FILES.length, status: 'open',
    })
    .returning();
  await db.insert(t.prFiles).values(FILES.map((path) => ({ prId: pr!.id, path, additions: 1, deletions: 0 })));
  return pr!;
}

async function addReview(db: PgFixture['handle']['db'], workspaceId: string, prId: string, agentId: string, createdAt: Date, lines: number[]) {
  const [rv] = await db
    .insert(t.reviews)
    .values({ workspaceId, prId, agentId, kind: 'review', verdict: 'comment', summary: 's', score: 50, model: 'm', createdAt })
    .returning();
  if (lines.length) {
    await db.insert(t.findings).values(
      lines.map((n) => ({
        reviewId: rv!.id, file: 'server/src/x.ts', startLine: n, endLine: n, severity: 'WARNING',
        category: 'bug', title: 't', rationale: 'r', confidence: 0.8,
      })),
    );
  }
}

d('smart-diff route (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  const llm = new MockLLMProvider('openai');

  const app = () => buildApp({ config: config(), db: pg.handle.db, overrides: { llm: { openai: llm } } });

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('groups in fixed order before any review, contract-valid, no LLM call', async () => {
    const pr = await setupPr(pg.handle.db, workspaceId);
    const a = await app();
    const res = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = SmartDiff.parse(res.json());
    expect(body.groups.map((g) => g.role)).toEqual(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
    expect(body.groups.flatMap((g) => g.files).every((f) => f.finding_lines.length === 0)).toBe(true);
    expect(llm.calls).toHaveLength(0);
    await a.close();
  });

  it('uses finding start_lines of the newest review per agent only', async () => {
    const pr = await setupPr(pg.handle.db, workspaceId);
    const [ag] = await pg.handle.db.select().from(t.agents);
    await addReview(pg.handle.db, workspaceId, pr.id, ag!.id, new Date('2026-01-01'), [99]);
    await addReview(pg.handle.db, workspaceId, pr.id, ag!.id, new Date('2026-01-02'), [12]);
    const a = await app();
    const res = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    const core = SmartDiff.parse(res.json()).groups.find((g) => g.role === 'core')!;
    expect(core.files[0]!.finding_lines).toEqual([12]);
    expect(llm.calls).toHaveLength(0);
    await a.close();
  });

  it('404 for unknown PR and for a PR in another workspace', async () => {
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'other' }).returning();
    const foreign = await setupPr(pg.handle.db, other!.id);
    const a = await app();
    const unknown = await a.inject({ method: 'GET', url: '/pulls/00000000-0000-4000-8000-000000000000/smart-diff' });
    expect(unknown.statusCode).toBe(404);
    const cross = await a.inject({ method: 'GET', url: `/pulls/${foreign.id}/smart-diff` });
    expect(cross.statusCode).toBe(404);
    await a.close();
  });
});
