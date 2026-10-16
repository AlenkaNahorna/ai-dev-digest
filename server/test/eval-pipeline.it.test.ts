import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** Model fixture: one valid finding (line 11) and one hallucinated (line 999, dropped by the gate). */
const REVIEW: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    { id: 'f1', severity: 'CRITICAL', category: 'security', title: 'Hardcoded Stripe secret key', file: 'src/config.ts', start_line: 11, end_line: 11, rationale: 'r', confidence: 0.9, kind: 'finding' },
    { id: 'f2', severity: 'WARNING', category: 'bug', title: 'Phantom', file: 'src/config.ts', start_line: 999, end_line: 999, rationale: 'r', confidence: 0.5, kind: 'finding' },
  ],
};

d('L06 eval pipeline (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const app = () =>
    buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        llm: {
          openai: new MockLLMProvider('openai', { structured: REVIEW }),
          openrouter: new MockLLMProvider('openai', {
            structuredBySchema: { IntentClassification: { summary: 'x', in_scope: [], out_of_scope: [], confidence: 'medium', missing_context: [] } },
          }),
        },
      },
    });

  it('accept → must_find, dismiss → must_not_flag, run, history, compare, dashboard', async () => {
    const a = await app();
    const db = pg.handle.db;

    const [repo] = await db.insert(t.repos).values({ workspaceId, owner: 'acme', name: 'eval-api', fullName: 'acme/eval-api' }).returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({ workspaceId, repoId: repo!.id, number: 7, title: 'Add key', author: 'x', branch: 'f', base: 'main', headSha: 'abc', additions: 1, deletions: 0, filesCount: 1, status: 'needs_review', body: '' })
      .returning();
    await db.insert(t.prFiles).values({ prId: pr!.id, path: 'src/config.ts', additions: 1, deletions: 0, patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,' });

    const agent = (await a.inject({ method: 'POST', url: '/agents', payload: { name: 'Sec', provider: 'openai', model: 'gpt-4.1', system_prompt: 'be precise' } })).json();
    await a.inject({ method: 'POST', url: `/pulls/${pr!.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(db, pr!.id, { expected: 1 });
    const [review] = await db.select().from(t.reviews).where(eq(t.reviews.prId, pr!.id));
    const [kept] = await db.select().from(t.findings).where(eq(t.findings.reviewId, review!.id));
    expect(kept).toBeDefined();
    const [noise] = await db
      .insert(t.findings)
      .values({ reviewId: review!.id, file: 'src/config.ts', startLine: 11, endLine: 11, severity: 'SUGGESTION', category: 'style', title: 'Noise', rationale: 'r', confidence: 0.4 })
      .returning();

    // undecided → 422
    expect((await a.inject({ method: 'POST', url: `/findings/${kept!.id}/eval-case` })).statusCode).toBe(422);

    await a.inject({ method: 'POST', url: `/findings/${kept!.id}/accept` });
    await a.inject({ method: 'POST', url: `/findings/${noise!.id}/dismiss` });

    const c1 = await a.inject({ method: 'POST', url: `/findings/${kept!.id}/eval-case` });
    expect(c1.statusCode).toBe(201);
    expect(c1.json().expectation.kind).toBe('must_find');
    expect(c1.json().input_diff).toContain('stripeKey');
    const c2 = await a.inject({ method: 'POST', url: `/findings/${noise!.id}/eval-case` });
    expect(c2.statusCode).toBe(201);
    expect(c2.json().expectation.kind).toBe('must_not_flag');
    expect((await a.inject({ method: 'POST', url: `/findings/${kept!.id}/eval-case` })).statusCode).toBe(409);

    const list = (await a.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` })).json();
    expect(list.cases).toHaveLength(2);

    // run 1: kept 2, noise 1, emitted 4 → recall 1, precision 0.5, citation 0.5
    const run1 = await a.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(run1.statusCode).toBe(200);
    expect(run1.json().summary).toMatchObject({ recall: 1, precision: 0.5, citation_accuracy: 0.5, cases_total: 2, cases_passed: 1, agent_version: 1 });

    // change the prompt → version 2 → run 2
    await a.inject({ method: 'PUT', url: `/agents/${agent.id}`, payload: { system_prompt: 'flag everything' } });
    const run2 = await a.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(run2.json().summary.agent_version).toBe(2);

    const history = (await a.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs` })).json();
    expect(history.batches).toHaveLength(2);

    const cmp = await a.inject({ method: 'GET', url: `/eval-runs/compare?a=${run1.json().summary.batch_id}&b=${run2.json().summary.batch_id}` });
    expect(cmp.statusCode).toBe(200);
    expect(cmp.json().config_a.system_prompt).toBe('be precise');
    expect(cmp.json().config_b.system_prompt).toBe('flag everything');

    const overview = (await a.inject({ method: 'GET', url: '/eval/overview' })).json();
    expect(overview.agents.find((x: { agent_id: string }) => x.agent_id === agent.id).cases_total).toBe(2);
    expect(overview.recent.length).toBeGreaterThanOrEqual(2);

    // validation + 404s
    expect((await a.inject({ method: 'GET', url: '/agents/not-a-uuid/eval-cases' })).statusCode).toBe(422);
    expect((await a.inject({ method: 'GET', url: '/agents/00000000-0000-4000-8000-000000000000/eval-cases' })).statusCode).toBe(404);

    expect((await a.inject({ method: 'DELETE', url: `/eval-cases/${c2.json().id}` })).statusCode).toBe(204);
    await a.close();
  });
});
