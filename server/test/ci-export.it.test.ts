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
