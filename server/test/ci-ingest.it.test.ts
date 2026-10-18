import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

// The export use-case reads the bundled runner from disk; point it at a stub so
// `export-ci` succeeds without a real agent-runner ncc build (mirrors ci-export).
const bundleDir = mkdtempSync(path.join(tmpdir(), 'devdigest-ci-ingest-'));
const bundlePath = path.join(bundleDir, 'index.js');
writeFileSync(bundlePath, '// mock runner bundle\n');
process.env.DEVDIGEST_RUNNER_BUNDLE_PATH = bundlePath;

const createBody = {
  name: 'Ingest Agent',
  provider: 'openrouter' as const,
  model: 'deepseek/deepseek-v4-flash',
  system_prompt: 'Review the diff.',
};

d('CI ingest (integration)', () => {
  let pg: PgFixture;
  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  async function createAgent(
    app: Awaited<ReturnType<typeof makeApp>>,
    body = createBody,
  ): Promise<string> {
    const created = await app.inject({ method: 'POST', url: '/agents', payload: body });
    expect(created.statusCode).toBe(201);
    return created.json().id as string;
  }

  /** Export with `action: 'open_pr'` and return the agent id + one-time token. */
  async function exportAndToken(
    app: Awaited<ReturnType<typeof makeApp>>,
    repo: string,
  ): Promise<{ agentId: string; token: string }> {
    const agentId = await createAgent(app, { ...createBody, name: `Ingest Agent ${repo}` });
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { repo },
    });
    expect(res.statusCode).toBe(200);
    const token = res.json().ingest_token as string;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    return { agentId, token };
  }

  function validArtifact(over: Record<string, unknown> = {}) {
    return {
      findings_count: 2,
      critical: 1,
      warning: 1,
      suggestion: 0,
      cost_usd: 0.0123,
      duration_ms: 4200,
      agent: 'Ingest Agent',
      repository: 'acme/widgets',
      verdict: 'request_changes',
      commit_sha: 'deadbeef',
      run_id: '555',
      run_attempt: 1,
      pr_number: 42,
      ...over,
    };
  }

  it('valid ingest writes one ci_runs row, mirrors it into agent_runs (source=ci) and leaves run_traces/multi_agent_runs alone (AC-17)', async () => {
    const app = await makeApp();
    const { agentId, token } = await exportAndToken(app, 'acme/widgets');

    const [tracesBefore, multiBefore] = await Promise.all([
      pg.handle.db.select({ id: t.runTraces.runId }).from(t.runTraces),
      pg.handle.db.select({ id: t.multiAgentRuns.id }).from(t.multiAgentRuns),
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { authorization: `Bearer ${token}` },
      payload: validArtifact(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, deduped: false });

    const runs = await pg.handle.db
      .select({
        prNumber: t.ciRuns.prNumber,
        verdict: t.ciRuns.verdict,
        findingsCount: t.ciRuns.findingsCount,
        critical: t.ciRuns.critical,
        warning: t.ciRuns.warning,
        suggestion: t.ciRuns.suggestion,
        costUsd: t.ciRuns.costUsd,
        commitSha: t.ciRuns.commitSha,
        runId: t.ciRuns.runId,
        runAttempt: t.ciRuns.runAttempt,
        source: t.ciRuns.source,
        githubUrl: t.ciRuns.githubUrl,
      })
      .from(t.ciRuns)
      .where(eq(t.ciRuns.runId, '555'));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      prNumber: 42,
      verdict: 'request_changes',
      findingsCount: 2,
      critical: 1,
      warning: 1,
      suggestion: 0,
      commitSha: 'deadbeef',
      runId: '555',
      runAttempt: 1,
      source: 'gha',
      githubUrl: 'https://github.com/acme/widgets/actions/runs/555',
    });
    expect(Number(runs[0]!.costUsd)).toBeCloseTo(0.0123, 6);

    // The run is mirrored into agent_runs as a CI run (default gate: critical → 1 blocker).
    const mirrored = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.agentId, agentId));
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0]).toMatchObject({
      source: 'ci',
      status: 'succeeded',
      findingsCount: 2,
      blockers: 1,
      durationMs: 4200,
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
    });
    expect(Number(mirrored[0]!.costUsd)).toBeCloseTo(0.0123, 6);

    // …but a CI run has no trace and is not a multi-agent run.
    expect(await pg.handle.db.select({ id: t.runTraces.runId }).from(t.runTraces)).toHaveLength(
      tracesBefore.length,
    );
    expect(
      await pg.handle.db.select({ id: t.multiAgentRuns.id }).from(t.multiAgentRuns),
    ).toHaveLength(multiBefore.length);
    await app.close();
  });

  it('rejects a repo mismatch generically and an invalid payload with 422; neither writes a row (AC-16)', async () => {
    const app = await makeApp();
    const { token } = await exportAndToken(app, 'acme/gadgets');

    // repository differs from the installation repo → generic rejection, no leak.
    const mismatch = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { authorization: `Bearer ${token}` },
      payload: validArtifact({ repository: 'acme/somewhere-else', run_id: 'mismatch-1' }),
    });
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json()).toEqual({ error: 'invalid_request' });

    // Payload failing CiResultArtifact (wrong type, missing verdict/repository)
    // is rejected at the Zod boundary with 422 before the handler runs.
    const invalid = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { authorization: `Bearer ${token}` },
      payload: { findings_count: 'not-a-number', cost_usd: null, agent: 'x' },
    });
    expect(invalid.statusCode).toBe(422);

    // Neither request persisted a run.
    const runs = await pg.handle.db
      .select({ id: t.ciRuns.id })
      .from(t.ciRuns)
      .where(eq(t.ciRuns.runId, 'mismatch-1'));
    expect(runs).toHaveLength(0);
    await app.close();
  });

  it('is idempotent: the same (installation, run_id, run_attempt) twice leaves one row (AC-18)', async () => {
    const app = await makeApp();
    const { agentId, token } = await exportAndToken(app, 'acme/dedupe');
    const payload = validArtifact({ repository: 'acme/dedupe', run_id: '777', run_attempt: 2 });

    const first = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ ok: true, deduped: false });

    const second = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ ok: true, deduped: true });

    const runs = await pg.handle.db
      .select({ id: t.ciRuns.id })
      .from(t.ciRuns)
      .where(and(eq(t.ciRuns.runId, '777'), eq(t.ciRuns.runAttempt, 2)));
    expect(runs).toHaveLength(1);
    // The replay must not double-count in agent_runs either.
    expect(
      await pg.handle.db.select({ id: t.agentRuns.id }).from(t.agentRuns).where(eq(t.agentRuns.agentId, agentId)),
    ).toHaveLength(1);
    await app.close();
  });

  it('matches the artifact repository case-insensitively (AC-16)', async () => {
    const app = await makeApp();
    const { token } = await exportAndToken(app, 'acme/casing');
    const res = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { authorization: `Bearer ${token}` },
      payload: validArtifact({ repository: 'ACME/Casing', run_id: 'case-1', run_attempt: 1 }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, deduped: false });
    await app.close();
  });

  it('dedupes a replay that omits run_attempt (defaults to 1) — NULLs must not defeat AC-18', async () => {
    const app = await makeApp();
    const { agentId, token } = await exportAndToken(app, 'acme/noattempt');
    const { run_attempt: _omit, ...payload } = validArtifact({ repository: 'acme/noattempt', run_id: 'na-1' }) as Record<string, unknown>;

    const send = () =>
      app.inject({ method: 'POST', url: '/ci/ingest', headers: { authorization: `Bearer ${token}` }, payload });
    expect((await send()).json()).toEqual({ ok: true, deduped: false });
    expect((await send()).json()).toEqual({ ok: true, deduped: true });

    const runs = await pg.handle.db
      .select({ attempt: t.ciRuns.runAttempt })
      .from(t.ciRuns)
      .where(eq(t.ciRuns.runId, 'na-1'));
    expect(runs).toEqual([{ attempt: 1 }]);
    expect(
      await pg.handle.db.select({ id: t.agentRuns.id }).from(t.agentRuns).where(eq(t.agentRuns.agentId, agentId)),
    ).toHaveLength(1);
    await app.close();
  });

  it('rejects an unknown/invalid bearer token with a generic 401 (AC-15)', async () => {
    const app = await makeApp();
    // Well-formed-looking but never-issued credential → generic 401, no enumeration.
    const neverIssued = '0'.repeat(64);
    const res = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { authorization: `Bearer ${neverIssued}` },
      payload: validArtifact(),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid_request' });
    await app.close();
  });

  it('export with action:"files" returns files but creates no installation, no token, no GitHub write (AC-2)', async () => {
    // A GitHub client whose writes throw — if the preview wrote anything the
    // request would fail. Success proves the preview performs no GitHub write.
    const github = new MockGitHubClient();
    github.commitFiles = async () => {
      throw new Error('commitFiles must not be called for action:files');
    };
    github.openPullRequest = async () => {
      throw new Error('openPullRequest must not be called for action:files');
    };
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github },
    });
    const agentId = await createAgent(app, { ...createBody, name: 'Files Preview Agent' });

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { repo: 'acme/preview', action: 'files' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.installation).toBeNull();
    expect(body.pr_url).toBeNull();
    expect(body.ingest_token).toBeNull();
    const paths = (body.files as { path: string }[]).map((f) => f.path);
    expect(paths).toContain('.github/workflows/devdigest-review.yml');
    expect(paths).toContain('.devdigest/runner/index.js');

    // No GitHub write recorded by the (throw-on-write) client.
    expect(github.committed).toHaveLength(0);
    expect(github.openedPrs).toHaveLength(0);
    await app.close();
  });

  it('GET /ci-runs returns at most 50 rows (ran_at desc, id desc), each with repo; empty workspace returns [] (AC-19)', async () => {
    const app = await makeApp();
    const { token } = await exportAndToken(app, 'acme/runslist');

    // Ingest 51 runs through the authenticated endpoint (distinct run_id so the
    // dedupe index does not collapse them) to assert the 50-row cap + ordering.
    for (let i = 0; i < 51; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/ci/ingest',
        headers: { authorization: `Bearer ${token}` },
        payload: validArtifact({
          repository: 'acme/runslist',
          verdict: 'approve',
          run_id: `runslist-${i}`,
          run_attempt: 1,
          pr_number: i,
        }),
      });
      expect(res.statusCode).toBe(200);
    }

    const res = await app.inject({ method: 'GET', url: '/ci-runs' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { repo: string | null; ran_at: string | null; pr_number: number }[];
    // Only this agent's runs exist in the default workspace → exactly the cap.
    const mine = rows.filter((r) => r.repo === 'acme/runslist');
    expect(mine).toHaveLength(50);
    expect(mine.every((r) => r.repo === 'acme/runslist')).toBe(true);
    // ran_at is non-increasing down the list (newest first).
    for (let i = 1; i < mine.length; i++) {
      const prev = Date.parse(mine[i - 1]!.ran_at!);
      const cur = Date.parse(mine[i]!.ran_at!);
      expect(prev).toBeGreaterThanOrEqual(cur);
    }

    // A workspace with no CI runs resolves to an empty list at the repository.
    const [emptyWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `empty-${Date.now()}` })
      .returning();
    const emptyRuns = await pg.handle.db
      .select({ id: t.ciRuns.id })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciRuns.ciInstallationId, t.ciInstallations.id))
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, emptyWs!.id));
    expect(emptyRuns).toHaveLength(0);
    await app.close();
  });

  it('GET /agents/:id/ci-installations rows include agent_id, latest_verdict and latest_ran_at (AC-1)', async () => {
    const app = await makeApp();
    const { agentId, token } = await exportAndToken(app, 'acme/tab');

    // Before any run, the latest-run fields are null.
    const before = await app.inject({ method: 'GET', url: `/agents/${agentId}/ci-installations` });
    expect(before.statusCode).toBe(200);
    const beforeRows = before.json() as {
      agent_id: string;
      repo: string;
      latest_verdict: string | null;
      latest_ran_at: string | null;
    }[];
    expect(beforeRows).toHaveLength(1);
    expect(beforeRows[0]).toMatchObject({
      agent_id: agentId,
      repo: 'acme/tab',
      latest_verdict: null,
      latest_ran_at: null,
    });

    // After a run ingests, the latest outcome is reflected in the tab.
    await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { authorization: `Bearer ${token}` },
      payload: validArtifact({ repository: 'acme/tab', verdict: 'approve', run_id: 'tab-1' }),
    });
    const after = (
      await app.inject({ method: 'GET', url: `/agents/${agentId}/ci-installations` })
    ).json() as { agent_id: string; latest_verdict: string | null; latest_ran_at: string | null }[];
    expect(after[0]!.agent_id).toBe(agentId);
    expect(after[0]!.latest_verdict).toBe('approve');
    expect(typeof after[0]!.latest_ran_at).toBe('string');
    await app.close();
  });

  it('is workspace-scoped: a foreign agent/installation is invisible and cannot be exported (AC-20)', async () => {
    const app = await makeApp();
    const { db } = pg.handle;

    // An agent + installation + run that live in a DIFFERENT workspace.
    const [otherWs] = await db
      .insert(t.workspaces)
      .values({ name: `other-${Date.now()}` })
      .returning();
    const [foreignAgent] = await db
      .insert(t.agents)
      .values({
        workspaceId: otherWs!.id,
        name: 'Foreign CI Agent',
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        systemPrompt: 'x',
      })
      .returning();
    const [foreignInst] = await db
      .insert(t.ciInstallations)
      .values({ agentId: foreignAgent!.id, repo: 'other/foreign', targetType: 'gha', tokenHash: 'x'.repeat(64) })
      .returning();
    await db.insert(t.ciRuns).values({
      ciInstallationId: foreignInst!.id,
      prNumber: 1,
      ranAt: new Date(),
      verdict: 'approve',
      findingsCount: 0,
      costUsd: null,
      runId: 'foreign-1',
      runAttempt: 1,
      githubUrl: null,
      source: 'gha',
    });

    // The default-workspace request context cannot see the foreign agent:
    // export is 404 and its installations list is empty.
    const exportForeign = await app.inject({
      method: 'POST',
      url: `/agents/${foreignAgent!.id}/export-ci`,
      payload: { repo: 'other/foreign' },
    });
    expect(exportForeign.statusCode).toBe(404);
    expect(exportForeign.json().error.code).toBe('agent_not_found');

    const foreignInstalls = await app.inject({
      method: 'GET',
      url: `/agents/${foreignAgent!.id}/ci-installations`,
    });
    expect(foreignInstalls.statusCode).toBe(200);
    expect(foreignInstalls.json()).toEqual([]);

    // The foreign run never appears in the default workspace's CI-Runs list.
    const runs = (await app.inject({ method: 'GET', url: '/ci-runs' })).json() as {
      repo: string | null;
    }[];
    expect(runs.some((r) => r.repo === 'other/foreign')).toBe(false);
    await app.close();
  });
});
