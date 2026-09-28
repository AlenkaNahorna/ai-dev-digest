import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@ export const config
   port: 3000,
+  limit: 100,
   redisUrl: x,`;

const INTENT = {
  summary: 'Add rate limiting to public endpoints',
  in_scope: ['limiter middleware'],
  out_of_scope: ['auth changes'],
  confidence: 'high',
  missing_context: [],
};
const REVIEW = { verdict: 'comment', summary: 'ok', score: 95, findings: [] };

d('Intent layer (Testcontainers pg)', () => {
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

  it('classifies on a SEPARATE cheap model, injects the intent into the review, persists + flags stale', async () => {
    const intentLlm = new MockLLMProvider('openai', { structuredBySchema: { IntentClassification: INTENT } });
    const reviewLlm = new MockLLMProvider('openai', { structuredBySchema: { Review: REVIEW } });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        // `review_intent` defaults to openrouter; the agent below uses openai.
        llm: { openrouter: intentLlm, openai: reviewLlm },
      },
    });

    const db = pg.handle.db;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'intent-api', fullName: 'acme/intent-api' })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 7,
        title: 'Add rate limiting',
        author: 'a',
        branch: 'feat',
        base: 'main',
        headSha: 'sha-1',
        status: 'needs_review',
        body: 'Rate limit public endpoints. Spec: https://notion.so/team/spec',
      })
      .returning();
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Gen', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
      })
    ).json();

    expect((await app.inject({ method: 'GET', url: `/pulls/${pr!.id}/intent` })).json()).toBeNull();

    await app.inject({ method: 'POST', url: `/pulls/${pr!.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(db, pr!.id, { expected: 1 });

    // Two separate LLM calls on two separate models/providers.
    const intentCall = intentLlm.calls.find((c) => c.method === 'completeStructured')!.req as {
      model: string;
      schemaName: string;
      messages: { content: string }[];
    };
    const reviewCall = reviewLlm.calls.find((c) => c.method === 'completeStructured')!.req as {
      model: string;
      messages: { content: string }[];
    };
    expect(intentCall.schemaName).toBe('IntentClassification');
    expect(intentCall.model).not.toBe(reviewCall.model);
    expect(intentCall.messages.map((m) => m.content).join('\n')).not.toContain('limit: 100'); // no change bodies
    expect(reviewCall.messages[1]!.content).toContain('## PR intent');

    const rec = (await app.inject({ method: 'GET', url: `/pulls/${pr!.id}/intent` })).json();
    expect(rec.summary).toBe(INTENT.summary);
    expect(rec.stale).toBe(false);
    expect(rec.confidence).toBe('medium'); // unresolved Notion spec caps "high"
    expect(rec.missing_context.join(' ')).toContain('notion.so/team/spec');

    // The trace records the classifier call separately from the review.
    const [run] = await db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr!.id));
    const trace = (await app.inject({ method: 'GET', url: `/runs/${run!.id}/trace` })).json();
    expect(trace.intent_call.model).toBe(intentCall.model);
    expect(trace.intent_call.cached).toBe(false);

    // Editing only the description (same head) also marks the intent stale.
    await db.update(t.pullRequests).set({ body: 'Rate limit public endpoints (rewritten).' }).where(eq(t.pullRequests.id, pr!.id));
    expect((await app.inject({ method: 'GET', url: `/pulls/${pr!.id}/intent` })).json().stale).toBe(true);

    // PR head moves → stale; user re-derives → fresh again.
    await db.update(t.pullRequests).set({ headSha: 'sha-2' }).where(eq(t.pullRequests.id, pr!.id));
    expect((await app.inject({ method: 'GET', url: `/pulls/${pr!.id}/intent` })).json().stale).toBe(true);
    const re = await app.inject({ method: 'POST', url: `/pulls/${pr!.id}/intent` });
    expect(re.statusCode).toBe(200);
    expect(re.json().stale).toBe(false);

    await app.close();
  });
});
