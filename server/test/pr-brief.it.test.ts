/**
 * PR Brief routes + facts gatherer against a real Postgres (Testcontainers).
 * LLM, git, repo-intel and Project Context are faked; the database is real.
 * Self-skips when Docker is unavailable.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { PrBrief } from '@devdigest/shared';
import type { ProjectContextFacade } from '../src/modules/project-context/application/facade.js';
import type { ResolvedRunContext } from '../src/modules/project-context/application/use-cases/resolve-for-run.js';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { BlastResult, RepoIntel } from '../src/modules/repo-intel/types.js';
import type { ContainerOverrides } from '../src/platform/container.js';
import { FactsGatherer } from '../src/modules/pr-brief/adapters/outbound/providers/facts-gatherer.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const CODE_LINE = 'leakedCodeLine_9f3a();';
const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 keep
+${CODE_LINE}
 end`;

const BRIEF_FIXTURE = (summary: string) => ({
  summary,
  risks: [
    { kind: 'compat', title: 'Callers may break', explanation: 'e', severity: 'high', file_refs: ['src/b.ts', 'src/ghost.ts'] },
    { kind: 'invented', title: 'Ungrounded', explanation: 'e', severity: 'low', file_refs: ['src/ghost.ts'] },
  ],
  review_focus: [
    { file: 'src/a.ts', line: 3, reason: 'new call' },
    { file: 'src/ghost.ts', line: 1, reason: 'not part of the PR' },
  ],
});

const FACADE: BlastResult = {
  changedSymbols: [{ name: 'a', file: 'src/a.ts', kind: 'function' }],
  callers: [{ file: 'src/b.ts', symbol: 'caller', viaSymbol: 'a', line: 7, rank: 1 }],
  impactedEndpoints: [],
};

let seq = 0;
async function setupPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  opts: { files?: string[]; title?: string; body?: string } = {},
) {
  const files = opts.files ?? ['src/a.ts'];
  const name = `brief-${seq++}`;
  const [repo] = await db.insert(t.repos).values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` }).returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId, repoId: repo!.id, number: 1, title: opts.title ?? 'Add limiter', author: 'a', branch: 'b', base: 'main',
      headSha: 'abc', additions: 1, deletions: 0, filesCount: files.length, status: 'open', body: opts.body ?? 'Adds a limiter',
    })
    .returning();
  if (files.length) await db.insert(t.prFiles).values(files.map((path) => ({ prId: pr!.id, path, additions: 1, deletions: 0 })));
  return { pr: pr!, repo: repo! };
}

const NO_DOCS: ResolvedRunContext = { docs: [], skipped: [] };
const textOf = (llm: MockLLMProvider): string =>
  (llm.calls[0]!.req as { messages: { content: string }[] }).messages.map((m) => m.content).join('\n');

d('pr-brief (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  const fixtures: Record<string, unknown> = { pr_brief: BRIEF_FIXTURE('First summary') };
  const perAgent = new Map<string, ResolvedRunContext>();
  const resolveForRun = vi.fn(async (_w: string, agentId: string) => perAgent.get(agentId) ?? NO_DOCS);
  const projectContext = { resolveForRun } as unknown as ProjectContextFacade;
  const repoIntel = { getBlastRadius: vi.fn(async (): Promise<BlastResult> => FACADE) } as unknown as RepoIntel;

  let openai: MockLLMProvider;
  const app = (overrides: ContainerOverrides = {}) =>
    buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai }, git: new MockGitClient({ diff: DIFF }), repoIntel, projectContext, ...overrides },
    });

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const reset = () => {
    openai = new MockLLMProvider('openai', { structuredBySchema: fixtures });
    fixtures.pr_brief = BRIEF_FIXTURE('First summary');
    perAgent.clear();
    resolveForRun.mockClear();
  };
  const rows = (prId: string) => pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));

  it('GET is null before generation; POST stores a grounded brief with one model call; reload reads it with no model call (AC-7, AC-15, AC-17, AC-19..21, AC-22)', async () => {
    reset();
    const { pr } = await setupPr(pg.handle.db, workspaceId, { files: ['src/a.ts', 'README.md'] });
    const a = await app();

    const empty = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toBeNull();
    expect(openai.calls).toHaveLength(0);

    const post = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(post.statusCode).toBe(200);
    const brief = PrBrief.parse(post.json());
    expect(brief.summary).toBe('First summary');
    // risk kept with its grounded caller file only; the ungrounded risk is gone
    expect(brief.risks.risks.map((r) => [r.title, r.file_refs])).toEqual([['Callers may break', ['src/b.ts']]]);
    // focus item on a file outside the PR is dropped; the line is not a finding line → null
    expect(brief.review_focus).toEqual([{ file: 'src/a.ts', line: null, reason: 'new call' }]);
    expect(brief.missing_inputs).toEqual(['intent', 'findings', 'documents']);
    expect(brief.partial).toBe(false);

    // exactly one structured call, on the registry default risk_brief model, with facts only
    expect(openai.calls.map((c) => c.method)).toEqual(['completeStructured']);
    const req = openai.calls[0]!.req as { model: string; schemaName: string };
    expect(req).toMatchObject({ model: 'gpt-4.1', schemaName: 'pr_brief' });
    const sent = textOf(openai);
    expect(sent).toContain('src/a.ts (+1 -0, core)');
    expect(sent).toContain('src/b.ts');
    expect(sent).not.toContain(CODE_LINE);

    // reload: same brief, still one model call, one row
    const get1 = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    const get2 = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(get1.json()).toEqual(brief);
    expect(get2.json()).toEqual(brief);
    expect(openai.calls).toHaveLength(1);
    expect(await rows(pr.id)).toHaveLength(1);
    await a.close();
  });

  it('regeneration replaces the single stored brief; a failed regeneration keeps it and leaks no provider text (AC-5, AC-22, AC-23)', async () => {
    reset();
    const { pr } = await setupPr(pg.handle.db, workspaceId);
    const a = await app();
    await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });

    fixtures.pr_brief = BRIEF_FIXTURE('Second summary');
    const second = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(second.statusCode).toBe(200);
    expect(PrBrief.parse(second.json()).summary).toBe('Second summary');
    expect(await rows(pr.id)).toHaveLength(1);

    vi.spyOn(openai, 'completeStructured').mockRejectedValueOnce(new Error('upstream 401 key sk-leak-abcdef1234567890'));
    const failed = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error.code).toBe('brief_model_failed');
    expect(failed.payload).not.toContain('sk-leak');

    const after = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(PrBrief.parse(after.json()).summary).toBe('Second summary');
    expect(await rows(pr.id)).toHaveLength(1);
    await a.close();
  });

  it('answers 422 and makes no model call when neither the git diff nor pr_files has a file (AC-28a)', async () => {
    reset();
    const { pr } = await setupPr(pg.handle.db, workspaceId, { files: [] });
    const a = await app({ git: new MockGitClient({ diff: '' }) });
    const res = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('brief_files_unavailable');
    expect(openai.calls).toHaveLength(0);
    expect(await rows(pr.id)).toHaveLength(0);
    await a.close();
  });

  it('takes files from the git diff first and falls back to pr_files when the diff is empty or the clone is unavailable (AC-28)', async () => {
    reset();
    const { pr } = await setupPr(pg.handle.db, workspaceId, { files: ['docs/only-in-db.md'] });

    const viaGit = await app();
    await viaGit.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(textOf(openai)).toContain('src/a.ts (+1 -0, core)');
    expect(textOf(openai)).not.toContain('docs/only-in-db.md');
    await viaGit.close();

    reset();
    const emptyDiff = await app({ git: new MockGitClient({ diff: '' }) });
    expect((await emptyDiff.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` })).statusCode).toBe(200);
    expect(textOf(openai)).toContain('docs/only-in-db.md (+1 -0, docs)');
    await emptyDiff.close();

    reset();
    const noClone = new MockGitClient();
    noClone.diff = async () => {
      throw new Error('clone missing');
    };
    const broken = await app({ git: noClone });
    expect((await broken.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` })).statusCode).toBe(200);
    expect(textOf(openai)).toContain('docs/only-in-db.md');
    await broken.close();
  });

  it('treats a PR of another workspace like a missing PR on both routes and touches nothing (AC-30)', async () => {
    reset();
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-brief' }).returning();
    const { pr } = await setupPr(pg.handle.db, other!.id);
    const a = await app();
    const get = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    const post = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(get.statusCode).toBe(404);
    expect(post.statusCode).toBe(404);
    expect(get.payload).not.toContain('summary');
    expect(openai.calls).toHaveLength(0);
    expect(resolveForRun).not.toHaveBeenCalled();
    expect(await rows(pr.id)).toHaveLength(0);
    await a.close();
  });

  it('answers 403 for a user who is not a member of the workspace', async () => {
    reset();
    const { pr } = await setupPr(pg.handle.db, workspaceId);
    const [stranger] = await pg.handle.db.insert(t.users).values({ email: 'stranger@brief.test', name: 'Stranger' }).returning();
    const a = await app({
      auth: {
        currentUser: async () => ({ id: stranger!.id, email: stranger!.email, name: stranger!.name }),
        currentWorkspace: async () => ({ id: workspaceId, name: 'default' }),
      },
    });
    expect((await a.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` })).statusCode).toBe(403);
    expect((await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` })).statusCode).toBe(403);
    expect(openai.calls).toHaveLength(0);
    await a.close();
  });

  it('rejects a malformed pull id with 422 and an unknown one with 404', async () => {
    reset();
    const a = await app();
    expect((await a.inject({ method: 'GET', url: '/pulls/not-a-uuid/brief' })).statusCode).toBe(422);
    expect((await a.inject({ method: 'POST', url: '/pulls/not-a-uuid/brief' })).statusCode).toBe(422);
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect((await a.inject({ method: 'GET', url: `/pulls/${unknown}/brief` })).statusCode).toBe(404);
    expect((await a.inject({ method: 'POST', url: `/pulls/${unknown}/brief` })).statusCode).toBe(404);
    await a.close();
  });

  it('treats a stored row that no longer parses as "no brief" so it can be regenerated', async () => {
    reset();
    const { pr } = await setupPr(pg.handle.db, workspaceId);
    await pg.handle.db.insert(t.prBrief).values({ prId: pr.id, json: { legacy: true } });
    const a = await app();
    expect((await a.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` })).json()).toBeNull();
    const post = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(post.statusCode).toBe(200);
    expect(await rows(pr.id)).toHaveLength(1);
    await a.close();
  });

  describe('facts gatherer (AC-16, AC-16a, AC-16b, AC-17, AC-18)', () => {
    it('merges documents across agents in creation order, first path wins, and logs skipped paths only', async () => {
      reset();
      const { pr } = await setupPr(pg.handle.db, workspaceId);
      const agents = await pg.handle.db
        .select({ id: t.agents.id })
        .from(t.agents)
        .where(eq(t.agents.workspaceId, workspaceId))
        .orderBy(asc(t.agents.createdAt), asc(t.agents.id));
      expect(agents.length).toBeGreaterThanOrEqual(3);
      const gone = { path: 'docs/gone.md', reason: 'unreadable' as const };
      perAgent.set(agents[0]!.id, {
        docs: [
          { path: 'docs/a.md', text: 'A-TEXT', tokens: 2 },
          { path: 'docs/shared.md', text: 'FROM-FIRST', tokens: 3 },
        ],
        skipped: [],
      });
      perAgent.set(agents[1]!.id, {
        docs: [
          { path: 'docs/shared.md', text: 'FROM-SECOND', tokens: 3 },
          { path: 'docs/b.md', text: 'B-TEXT', tokens: 2 },
        ],
        skipped: [gone],
      });
      perAgent.set(agents[2]!.id, { docs: [], skipped: [gone] });

      const a = await app();
      const log = { info: vi.fn(), warn: vi.fn() };
      const facts = await new FactsGatherer(a.container, log).gather(workspaceId, pr.id);

      expect(resolveForRun).toHaveBeenCalledTimes(agents.length);
      expect(resolveForRun.mock.calls.map((c) => c[1])).toEqual(agents.map((x) => x.id));
      expect(facts!.documents.map((x) => [x.path, x.text])).toEqual([
        ['docs/a.md', 'A-TEXT'],
        ['docs/shared.md', 'FROM-FIRST'],
        ['docs/b.md', 'B-TEXT'],
      ]);
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(log.warn).toHaveBeenCalledWith('pr-brief: skipped document', { path: 'docs/gone.md', reason: 'unreadable' });
      expect(JSON.stringify(log.warn.mock.calls)).not.toContain('TEXT');
      await a.close();
    });

    it('lists documents as missing in the stored brief when nothing is attached (normal, not an error)', async () => {
      reset();
      const { pr } = await setupPr(pg.handle.db, workspaceId);
      const a = await app();
      const res = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
      expect(PrBrief.parse(res.json()).missing_inputs).toContain('documents');
      await a.close();
    });

    it('collects redacted PR text, intent, caller files, roles and the newest findings per agent: no bodies', async () => {
      reset();
      const db = pg.handle.db;
      const { pr } = await setupPr(db, workspaceId, {
        files: ['src/a.ts', 'README.md'],
        title: 'Use sk_live_abcdefgh12345678 for billing',
        body: 'config: api_key = "abcdef123456789" here',
      });
      await db.insert(t.prIntent).values({ prId: pr.id, intent: 'Add a limiter', inScope: ['limiter'], outOfScope: ['auth'] });

      const [agentA, agentB] = await db.select({ id: t.agents.id }).from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
      perAgent.set(agentA!.id, {
        docs: [{ path: 'docs/secret.md', text: 'use sk_live_docsecret12345678 here', tokens: 5 }],
        skipped: [],
      });
      const review = async (agentId: string, createdAt: string, titles: [string, number, string][]) => {
        const [r] = await db
          .insert(t.reviews)
          .values({ workspaceId, prId: pr.id, agentId, kind: 'review', createdAt: new Date(createdAt) })
          .returning();
        for (const [title, line, severity] of titles) {
          await db.insert(t.findings).values({
            reviewId: r!.id, file: 'src/a.ts', startLine: line, endLine: line, severity, category: 'bug', title,
            rationale: 'RATIONALE-BODY', suggestion: 'SUGGESTION-BODY', confidence: 0.9,
          });
        }
      };
      await review(agentA!.id, '2026-01-01T00:00:00Z', [['Old finding', 1, 'WARNING']]);
      await review(agentA!.id, '2026-02-01T00:00:00Z', [['New finding', 5, 'CRITICAL']]);
      await review(agentB!.id, '2026-01-15T00:00:00Z', [['Other agent finding', 9, 'SUGGESTION']]);

      const a = await app();
      const facts = (await new FactsGatherer(a.container).gather(workspaceId, pr.id))!;

      expect(facts.title).not.toContain('sk_live_abcdefgh12345678');
      expect(facts.title).toContain('[REDACTED]');
      expect(facts.description).not.toContain('abcdef123456789');
      expect(facts.intent).toEqual({ summary: 'Add a limiter', in_scope: ['limiter'], out_of_scope: ['auth'] });
      expect(facts.blast).toEqual({ summary: expect.any(String), degraded: false, callerFiles: ['src/b.ts'] });
      expect(facts.files).toEqual([{ path: 'src/a.ts', additions: 1, deletions: 0, role: 'core' }]); // git diff wins
      expect([...facts.findings].sort((x, y) => x.line - y.line)).toEqual([
        { file: 'src/a.ts', line: 5, severity: 'CRITICAL', title: 'New finding' },
        { file: 'src/a.ts', line: 9, severity: 'SUGGESTION', title: 'Other agent finding' },
      ]);
      expect(JSON.stringify(facts)).not.toContain('RATIONALE-BODY');
      expect(JSON.stringify(facts)).not.toContain('SUGGESTION-BODY');
      expect(JSON.stringify(facts)).not.toContain(CODE_LINE);
      await a.close();
    });

    it('redacts secrets in attached document text and in the stored intent before they can reach the model', async () => {
      reset();
      const db = pg.handle.db;
      const { pr } = await setupPr(db, workspaceId);
      await db.insert(t.prIntent).values({
        prId: pr.id,
        intent: 'Rotate sk_live_intentsecret12345678',
        inScope: ['api_key = "inscopesecret123456"'],
        outOfScope: ['token: outscopesecret123456'],
      });
      const [agentA] = await db.select({ id: t.agents.id }).from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
      perAgent.set(agentA!.id, { docs: [{ path: 'docs/s.md', text: 'key sk_live_docsecret12345678', tokens: 4 }], skipped: [] });
      const a = await app();
      const facts = (await new FactsGatherer(a.container).gather(workspaceId, pr.id))!;
      const json = JSON.stringify(facts);
      for (const secret of ['intentsecret', 'inscopesecret', 'outscopesecret', 'docsecret']) expect(json).not.toContain(secret);
      expect(facts.documents[0]!.text).toContain('[REDACTED]');
      expect(facts.intent!.summary).toContain('[REDACTED]');
      await a.close();
    });

    it('treats an empty blast result as missing and makes no other model call (AC-18)', async () => {
      reset();
      const { pr } = await setupPr(pg.handle.db, workspaceId);
      const a = await app({
        repoIntel: { getBlastRadius: async (): Promise<BlastResult> => ({ ...FACADE, callers: [] }) } as unknown as RepoIntel,
      });
      const res = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
      expect(PrBrief.parse(res.json()).missing_inputs).toContain('blast');
      expect(openai.calls.map((c) => c.method)).toEqual(['completeStructured']);
      await a.close();
    });
  });

  it('uses the provider and model configured for the risk_brief feature (AC-15)', async () => {
    reset();
    const anthropic = new MockLLMProvider('anthropic', { structuredBySchema: fixtures });
    const { pr } = await setupPr(pg.handle.db, workspaceId);
    const a = await app({ llm: { openai, anthropic } });
    const put = await a.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: { risk_brief: { provider: 'anthropic', model: 'claude-test-model' } } },
    });
    expect(put.statusCode).toBe(200);
    const res = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    expect(openai.calls).toHaveLength(0);
    expect(anthropic.calls).toHaveLength(1);
    expect((anthropic.calls[0]!.req as { model: string }).model).toBe('claude-test-model');
    await a.close();
  });
});
