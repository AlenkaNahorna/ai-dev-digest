import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const bundleDir = mkdtempSync(path.join(tmpdir(), 'devdigest-ci-bundle-'));
const bundlePath = path.join(bundleDir, 'index.js');
writeFileSync(bundlePath, '// mock runner bundle\n');
process.env.DEVDIGEST_RUNNER_BUNDLE_PATH = bundlePath;

const createBody = {
  name: 'CI Agent',
  provider: 'openrouter' as const,
  model: 'deepseek/deepseek-v4-flash',
  system_prompt: 'Review the diff.',
};

d('Export to CI (integration)', () => {
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

  async function createAgent(app: Awaited<ReturnType<typeof makeApp>>): Promise<string> {
    const created = await app.inject({ method: 'POST', url: '/agents', payload: createBody });
    expect(created.statusCode).toBe(201);
    return created.json().id as string;
  }

  it('export persists one installation, returns the credential once, and reconciles on re-run keeping it (AC-7)', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);

    const first = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { repo: 'acme/widgets' },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.installation.repo).toBe('acme/widgets');
    expect(firstBody.pr_url).toBe('https://github.com/mock/mock/pull/1');
    const paths = (firstBody.files as { path: string }[]).map((f) => f.path);
    expect(paths).toContain('.github/workflows/devdigest-review.yml');
    expect(paths).toContain('.devdigest/runner/index.js');
    expect(paths.some((p) => p.startsWith('.devdigest/agents/'))).toBe(true);
    const plaintext = firstBody.ingest_token as string;
    expect(plaintext).toMatch(/^[0-9a-f]{64}$/);

    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));
    expect(rows).toHaveLength(1);
    const storedHash = rows[0]!.tokenHash;
    expect(storedHash).toBe(createHash('sha256').update(plaintext, 'utf8').digest('hex'));

    const second = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { repo: 'acme/widgets' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().ingest_token).toBeNull();

    const after = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));
    expect(after).toHaveLength(1);
    expect(after[0]!.tokenHash).toBe(storedHash);
    await app.close();
  });

  it('preview includes memory.jsonl and a workflow built from the Configure choices; only the workflow is editable', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: {
        repo: 'acme/widgets',
        action: 'files',
        triggers: ['opened', 'synchronize', 'reopened'],
        post_as: 'pr_comment',
      },
    });
    expect(res.statusCode).toBe(200);
    const files = res.json().files as { path: string; contents: string; editable: boolean }[];
    const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
    expect(byPath['.devdigest/memory.jsonl']).toBeDefined();
    const workflow = byPath['.github/workflows/devdigest-review.yml']!;
    expect(workflow.contents).toMatch(/types:\s*\[opened, synchronize, reopened\]/);
    expect(workflow.contents).toContain('DEVDIGEST_POST_AS: pr_comment');
    expect(files.filter((f) => f.editable).map((f) => f.path)).toEqual([
      '.github/workflows/devdigest-review.yml',
    ]);
    await app.close();
  });

  it('applies workflow overrides, ignores overrides of locked files and rejects pull_request_target', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);
    const url = `/agents/${agentId}/export-ci`;

    const ok = await app.inject({
      method: 'POST',
      url,
      payload: {
        repo: 'acme/widgets',
        action: 'files',
        overrides: {
          '.github/workflows/devdigest-review.yml': 'name: Edited\non:\n  pull_request:\n',
          '.devdigest/runner/index.js': 'evil()',
        },
      },
    });
    expect(ok.statusCode).toBe(200);
    const files = ok.json().files as { path: string; contents: string }[];
    expect(files.find((f) => f.path.endsWith('devdigest-review.yml'))!.contents).toContain('name: Edited');
    expect(files.find((f) => f.path === '.devdigest/runner/index.js')!.contents).not.toContain('evil()');

    const bad = await app.inject({
      method: 'POST',
      url,
      payload: {
        repo: 'acme/widgets',
        action: 'files',
        overrides: { '.github/workflows/devdigest-review.yml': 'on:\n  pull_request_target:\n' },
      },
    });
    expect(bad.statusCode).toBe(422);
    await app.close();
  });

  it('refuses targets without a generator (circle/jenkins/cli)', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { repo: 'acme/widgets', target: 'circle' },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('action:"zip" persists the installation + token and records provenance, without opening a PR', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { repo: 'acme/zipped', action: 'zip', post_as: 'none', triggers: ['opened', 'synchronize'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pr_url).toBeNull();
    expect(body.ingest_token).toMatch(/^[0-9a-f]{64}$/);
    expect(body.installation).toMatchObject({ repo: 'acme/zipped', post_as: 'none', workflow_version: 4 });

    const list = await app.inject({ method: 'GET', url: `/agents/${agentId}/ci-installations` });
    expect(list.json()[0]).toMatchObject({
      repo: 'acme/zipped',
      workflow_version: 4,
      latest_workflow_version: 4,
      post_as: 'none',
      triggers: ['opened', 'synchronize'],
    });
    const history = await app.inject({ method: 'GET', url: `/agents/${agentId}/ci-runs` });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toEqual([]);
    await app.close();
  });

  it('ingest rejects a missing credential with a generic 401 (AC-15)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      payload: {
        findings_count: 0,
        cost_usd: null,
        agent: 'CI Agent',
        repository: 'acme/whatever',
        verdict: 'approve',
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid_request' });
    await app.close();
  });
});
