import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockAuthProvider,
  MockLLMProvider,
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
} from '../src/adapters/mocks.js';
import { ReviewRepository } from '../src/modules/reviews/adapters/outbound/persistence/repository.js';
import * as t from '../src/db/schema.js';
import { MultiAgentRun, RunTrace, type Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A diff touching src/config.ts line 11, so grounding keeps line 11 and drops line 999. */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

const MOCK_INTENT = {
  summary: 'Add rate limiting',
  in_scope: ['limiter'],
  out_of_scope: [],
  confidence: 'medium',
  missing_context: [],
};

/** An LLM provider whose every call fails — one agent that blows up mid-review. */
class ExplodingLLMProvider extends MockLLMProvider {
  override async completeStructured<T>(): Promise<never> {
    throw new Error('provider exploded');
  }
}

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `multi-agent-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('multi-agent review (Testcontainers pg)', () => {
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

  /** openai agents review fine; anthropic agents always fail. */
  function appWith() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        llm: {
          openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }),
          anthropic: new ExplodingLLMProvider('anthropic'),
          openrouter: new MockLLMProvider('openai', { structuredBySchema: { IntentClassification: MOCK_INTENT } }),
        },
      },
    });
  }

  async function createAgent(app: Awaited<ReturnType<typeof appWith>>, name: string, provider: 'openai' | 'anthropic') {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider, model: provider === 'openai' ? 'gpt-4.1' : 'claude-sonnet-4', system_prompt: name },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; name: string };
  }

  /** An app authenticated as a DIFFERENT workspace. */
  async function otherWorkspaceApp() {
    const [otherWorkspace] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-${randomUUID()}` })
      .returning();
    const [otherUser] = await pg.handle.db
      .insert(t.users)
      .values({ email: `${randomUUID()}@example.test`, name: 'Other' })
      .returning();
    await pg.handle.db
      .insert(t.workspaceMembers)
      .values({ workspaceId: otherWorkspace!.id, userId: otherUser!.id, role: 'owner' });
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        auth: new MockAuthProvider(
          { id: otherUser!.id, email: otherUser!.email, name: otherUser!.name },
          { id: otherWorkspace!.id, name: otherWorkspace!.name },
        ),
      },
    });
  }

  it('runs N agents under one parent; one failing agent does not hide the others (AC-17..19, 39)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const a1 = await createAgent(app, 'Security', 'openai');
    const a2 = await createAgent(app, 'Customer-Facing', 'openai');
    const a3 = await createAgent(app, 'Exploding', 'anthropic');

    const start = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [a1.id, a2.id, a3.id] },
    });
    expect(start.statusCode).toBe(200);
    const { parent_id, runs } = start.json() as { parent_id: string; runs: { run_id: string; agent_id: string }[] };
    expect(runs).toHaveLength(3);

    // exactly one parent row, and every per-agent run is linked to it
    const parents = await pg.handle.db.select().from(t.multiAgentRuns).where(eq(t.multiAgentRuns.prId, pr.id));
    expect(parents).toHaveLength(1);
    const linked = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.multiAgentRunId, parent_id));
    expect(linked).toHaveLength(3);

    await waitForPrRuns(pg.handle.db, pr.id, { expected: 3 });

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent/${parent_id}` });
    expect(res.statusCode).toBe(200);
    const run = MultiAgentRun.parse(res.json());

    expect(run.status).toBe('partial');
    expect(run.agent_count).toBe(3);
    const byAgent = new Map(run.columns.map((c) => [c.agent_id, c]));
    expect(byAgent.get(a1.id)!.status).toBe('done');
    expect(byAgent.get(a2.id)!.status).toBe('done');
    expect(byAgent.get(a3.id)!.status).toBe('failed'); // failed column stays in the parent
    // the others still render their findings; grounding dropped the hallucinated one
    expect(byAgent.get(a1.id)!.findings.map((f) => f.title)).toEqual(['Hardcoded Stripe secret key']);
    expect(byAgent.get(a3.id)!.findings).toEqual([]);

    // the same issue from two agents collapses into one group that keeps both originals
    const twoAgentGroups = run.groups.filter((g) => g.finding_ids.length === 2);
    expect(twoAgentGroups).toHaveLength(1);

    // a failed agent is no_result: it is not a "did not flag" and creates no conflict
    expect(run.conflicts.every((c) => !c.is_conflict)).toBe(true);

    // the failure reason is persisted on the run row
    const [failedRow] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, byAgent.get(a3.id)!.run_id));
    expect(failedRow!.status).toBe('failed');
    expect(failedRow!.error).toContain('provider exploded');

    // honest totals: cost is the sum of the KNOWN costs; wall-clock is not the sum of durations
    const known = run.columns.map((c) => c.cost_usd).filter((c): c is number => c !== null);
    if (known.length > 0) expect(run.total_cost_usd).toBeCloseTo(known.reduce((a, b) => a + b, 0), 10);
    expect(run.total_duration_ms).toBe(run.comparison.wall_clock_ms ?? 0);
    expect(run.comparison.agents_done).toBe(2);
    expect(run.comparison.baseline).toBeNull(); // no prior single-agent run on this PR

    await app.close();
  });

  it('the trace explains tokens, cost and the grounding gate decisions (and is versioned)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const a1 = await createAgent(app, 'Security', 'openai');
    const start = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [a1.id] },
    });
    const { runs } = start.json() as { runs: { run_id: string }[] };
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const traceRes = await app.inject({ method: 'GET', url: `/runs/${runs[0]!.run_id}/trace` });
    expect(traceRes.statusCode).toBe(200);
    const trace = RunTrace.parse(traceRes.json());

    expect(trace.schema_version).toBe(1);
    expect(trace.stats.tokens_in).toBeGreaterThan(0);
    expect(trace.stats.grounding).toBe('1/2 passed');
    const kept = trace.grounding_detail!.find((x) => x.kept);
    const dropped = trace.grounding_detail!.find((x) => !x.kept);
    expect(kept).toMatchObject({ gate: 'grounding', title: 'Hardcoded Stripe secret key', start_line: 11 });
    expect(dropped).toMatchObject({ gate: 'grounding', title: 'Phantom finding on a line not in the diff' });
    expect(dropped!.reason).toContain('do not intersect any diff hunk');
    // the intent classifier call is recorded once, beside the per-agent numbers
    expect(trace.intent_call).toBeTruthy();

    await app.close();
  });

  it('rejects an empty, duplicated or oversized agent set with 422 before the handler (AC-54)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const a1 = await createAgent(app, 'One', 'openai');

    const bodies = [
      { agent_ids: [] },
      { agent_ids: [a1.id, a1.id] },
      { agent_ids: ['not-a-uuid'] },
      { agent_ids: Array.from({ length: 7 }, () => randomUUID()) },
      {},
    ];
    for (const payload of bodies) {
      const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/multi-agent-run`, payload });
      expect(res.statusCode).toBe(422);
    }
    // nothing was started
    expect(await pg.handle.db.select().from(t.multiAgentRuns).where(eq(t.multiAgentRuns.prId, pr.id))).toHaveLength(0);
    await app.close();
  });

  it('refuses another workspace\'s PR, agents, parent and estimate with 403 and returns no data (AC-21, AC-53)', async () => {
    const app = await appWith();
    const other = await otherWorkspaceApp();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await createAgent(app, 'Mine', 'openai');
    const [parent] = await pg.handle.db.insert(t.multiAgentRuns).values({ workspaceId, prId: pr.id }).returning();

    const requests = [
      { method: 'POST' as const, url: `/pulls/${pr.id}/multi-agent-run`, payload: { agent_ids: [agent.id] } },
      { method: 'GET' as const, url: `/pulls/${pr.id}/multi-agent/${parent!.id}` },
      { method: 'POST' as const, url: `/pulls/${pr.id}/multi-agent/estimate`, payload: { agent_ids: [agent.id] } },
    ];
    for (const r of requests) {
      const res = await other.inject(r);
      expect(res.statusCode).toBe(403);
      expect(JSON.stringify(res.json())).not.toContain(agent.id);
    }

    // the owner passing someone else's agent id is refused too
    const foreignAgent = (
      await other.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Foreign', provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      })
    ).json() as { id: string };
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [foreignAgent.id] },
    });
    expect(res.statusCode).toBe(403);

    // a parent id under the WRONG pull-request id is refused as well
    const { pr: otherPr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    expect((await app.inject({ method: 'GET', url: `/pulls/${otherPr.id}/multi-agent/${parent!.id}` })).statusCode).toBe(403);

    await other.close();
    await app.close();
  });

  it('rejects a second start while a run on the PR is queued or running with 409 (D6)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await createAgent(app, 'Busy', 'openai');
    await pg.handle.db.insert(t.agentRuns).values({ workspaceId, agentId: agent.id, prId: pr.id, status: 'queued', source: 'local' });

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/multi-agent-run`, payload: { agent_ids: [agent.id] } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('multi_agent_run_active');
    await app.close();
  });

  it('malformed ids are rejected with 422 at the edge, never a 500 from the uuid cast', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const parent = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent/not-a-uuid` });
    const badPr = await app.inject({ method: 'GET', url: `/pulls/not-a-uuid/multi-agent/${randomUUID()}` });
    const latest = await app.inject({ method: 'GET', url: '/multi-agent/latest?repo_id=not-a-uuid' });

    for (const res of [parent, badPr, latest]) {
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
    }
    await app.close();
  });

  it('two concurrent starts on one PR: exactly one wins, the other gets 409, one parent only (no race)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const a1 = await createAgent(app, 'Race A', 'openai');
    const a2 = await createAgent(app, 'Race B', 'openai');

    const start = () =>
      app.inject({ method: 'POST', url: `/pulls/${pr.id}/multi-agent-run`, payload: { agent_ids: [a1.id, a2.id] } });
    const [r1, r2] = await Promise.all([start(), start()]);

    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
    const parents = await pg.handle.db.select({ id: t.multiAgentRuns.id }).from(t.multiAgentRuns).where(eq(t.multiAgentRuns.prId, pr.id));
    expect(parents).toHaveLength(1);
    await app.close();
  });

  it('estimate: mean of the last 5 done local runs, no fabricated number without history (AC-11, 13, 14)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const fresh = await createAgent(app, 'No history', 'openai');
    const seasoned = await createAgent(app, 'Seasoned', 'openai');

    // 6 done local runs (durations 1..6 s, newest = 6 s) + one CI run that must be ignored
    const base = Date.now() - 10 * 60_000;
    for (let i = 1; i <= 6; i += 1) {
      await pg.handle.db.insert(t.agentRuns).values({
        workspaceId, agentId: seasoned.id, prId: pr.id, status: 'done', source: 'local',
        durationMs: i * 1000, costUsd: i / 100, ranAt: new Date(base + i * 1000),
      });
    }
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId, agentId: seasoned.id, prId: pr.id, status: 'done', source: 'ci',
      durationMs: 999_000, costUsd: 9, ranAt: new Date(base + 60_000),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent/estimate`,
      payload: { agent_ids: [fresh.id, seasoned.id] },
    });
    expect(res.statusCode).toBe(200);
    const byAgent = new Map((res.json().estimates as { agent_id: string }[]).map((e) => [e.agent_id, e as never as Record<string, number | null>]));
    expect(byAgent.get(fresh.id)).toMatchObject({ sample_size: 0, mean_duration_ms: null, mean_cost_usd: null });
    // last 5 = 2..6 s -> mean 4 s, cost mean 0.04 (the older 1 s run and the CI run are out)
    expect(byAgent.get(seasoned.id)).toMatchObject({ sample_size: 5, mean_duration_ms: 4000 });
    expect(byAgent.get(seasoned.id)!.mean_cost_usd).toBeCloseTo(0.04, 10);
    await app.close();
  });

  it('1 vs N baseline: the latest completed single-agent run on the PR is returned (AC-51)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await createAgent(app, 'Solo', 'openai');
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId, agentId: agent.id, prId: pr.id, status: 'done', source: 'local',
      durationMs: 6000, tokensIn: 1000, tokensOut: 100, costUsd: 0.03,
    });
    const [parent] = await pg.handle.db.insert(t.multiAgentRuns).values({ workspaceId, prId: pr.id }).returning();
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId, agentId: agent.id, prId: pr.id, multiAgentRunId: parent!.id, status: 'done', source: 'local',
      durationMs: 5000, tokensIn: 900, tokensOut: 90, costUsd: 0.02,
    });

    const run = MultiAgentRun.parse((await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent/${parent!.id}` })).json());
    // the parent's own run is NOT the baseline; the earlier single-agent run is
    expect(run.comparison.baseline).toMatchObject({ agent_id: agent.id, tokens_in: 1000, cost_usd: 0.03, duration_ms: 6000 });
    await app.close();
  });

  it('latest: lands on the newest multi-agent review of a repo, or none (sidebar entry)', async () => {
    const app = await appWith();
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const none = await app.inject({ method: 'GET', url: `/multi-agent/latest?repo_id=${repo.id}` });
    expect(none.statusCode).toBe(200);
    expect(none.json()).toEqual({ latest: null });

    const [parent] = await pg.handle.db.insert(t.multiAgentRuns).values({ workspaceId, prId: pr.id }).returning();
    const some = await app.inject({ method: 'GET', url: `/multi-agent/latest?repo_id=${repo.id}` });
    expect(some.json()).toEqual({ latest: { pr_id: pr.id, parent_id: parent!.id } });
    await app.close();
  });

  it('a queued run flips to running when its worker starts it, and a run cancelled while queued is skipped', async () => {
    const repo = new ReviewRepository(pg.handle.db);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const queued = await repo.createAgentRun({ workspaceId, agentId: null, prId: pr.id, provider: null, model: null, status: 'queued' });
    const cancelled = await repo.createAgentRun({ workspaceId, agentId: null, prId: pr.id, provider: null, model: null, status: 'queued' });
    const single = await repo.createAgentRun({ workspaceId, agentId: null, prId: pr.id, provider: null, model: null });

    expect(await repo.cancelRunIfRunning(workspaceId, cancelled)).toBe(true);

    expect(await repo.markRunStarted(queued)).toBe('started');
    const [row] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, queued));
    expect(row!.status).toBe('running');
    expect(await repo.markRunStarted(cancelled)).toBe('skip');
    // single-agent runs are created 'running' and must keep executing unchanged
    expect(await repo.markRunStarted(single)).toBe('already_running');
  });
});
