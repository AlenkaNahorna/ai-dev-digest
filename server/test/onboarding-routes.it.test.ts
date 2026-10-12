import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../src/platform/errors.js';
import { dockerAvailable, startPg, type PgFixture } from './helpers/pg.js';
import * as t from '../src/db/schema.js';
import { OnboardingRepository } from '../src/modules/onboarding-generator/adapters/outbound/persistence/repository.js';
import { CryptoShareTokens } from '../src/modules/onboarding-generator/adapters/outbound/providers/share-tokens.js';
import { createGenerationLifecycle } from '../src/modules/onboarding-generator/application/use-cases/generation-lifecycle.js';
import { createGenerateTour } from '../src/modules/onboarding-generator/application/use-cases/generate-tour.js';
import onboardingRoutes from '../src/modules/onboarding-generator/adapters/inbound/http/routes.js';
import { SHA, evidence, model } from './helpers/onboarding-fixtures.js';
import { OnboardingTourState } from '../src/vendor/shared/contracts/onboarding-generator.js';

const hasDb = await dockerAvailable();
const d = hasDb ? describe : describe.skip;

d('onboarding HTTP routes (real Postgres, fake auth/index/model)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let workspaceId = '';
  let ownerId = '';
  let otherId = '';
  let repoId = '';
  const jobs: Array<{ kind: string; payload: unknown }> = [];
  const handlers = new Map<string, (p: unknown) => Promise<void>>();
  const indexListeners: Array<(id: string) => void> = [];

  const h = (user: string) => ({ 'x-test-user': user });

  beforeAll(async () => {
    pg = await startPg();
    const db = pg.handle.db;
    const sfx = Math.random().toString(36).slice(2, 8);
    const [ws] = await db.insert(t.workspaces).values({ name: `rt-${sfx}` }).returning();
    workspaceId = ws!.id;
    const [u1] = await db.insert(t.users).values({ email: `o-${sfx}@t.dev`, name: 'Owner' }).returning();
    const [u2] = await db.insert(t.users).values({ email: `x-${sfx}@t.dev`, name: 'Other' }).returning();
    ownerId = u1!.id;
    otherId = u2!.id;
    await db.insert(t.workspaceMembers).values([
      { workspaceId, userId: ownerId, role: 'owner' },
      { workspaceId, userId: otherId, role: 'member' },
    ]);
    const [r] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: `api-${sfx}`, fullName: `acme/api-${sfx}`, clonePath: '/tmp/x', createdBy: ownerId })
      .returning();
    repoId = r!.id;

    const container = {
      config: {
        nodeEnv: 'test',
        publicWebOrigin: 'https://app.example.com',
        webOrigin: 'http://localhost:3005',
        onboardingAutoGenerate: true,
        onboardingDailyBudget: 10,
        onboardingRetainedVersions: 5,
      },
      db,
      auth: {
        currentUser: async (req: { headers: Record<string, string> }) => ({ id: req.headers['x-test-user'] ?? ownerId }),
        currentWorkspace: async () => ({ id: workspaceId }),
      },
      jobs: {
        register: (kind: string, fn: (p: unknown) => Promise<void>) => void handlers.set(kind, fn),
        enqueue: async (_w: string, kind: string, payload: unknown) => void jobs.push({ kind, payload }),
      },
      repoIndexLock: { withLock: async (_i: string, fn: () => Promise<unknown>) => fn() },
      onIndexCompleted: (l: (id: string) => void) => void indexListeners.push(l),
      repoIntel: {
        getIndexState: async () => ({ status: 'full', lastIndexedSha: SHA, indexerVersion: 1, updatedAt: new Date() }),
        getTopFilesByRank: async () => ['src/app.ts'],
        getCriticalPaths: async () => [],
        getSymbolsInFiles: async () => [],
        getRepoMap: async () => ({ text: '', degraded: true }),
      },
    };

    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
      const e = err as { statusCode?: number; validation?: unknown };
      if (e.validation) return reply.status(422).send({ error: { code: 'validation_error' } });
      return reply.status(500).send({ error: { code: 'internal_error' } });
    });
    app.decorate('container', container as never);
    await app.register(onboardingRoutes);
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  async function publishOne() {
    // Produce a real tour version through the lifecycle, using the app's repository.
    const repo = new OnboardingRepository(pg.handle.db);
    const rec = (await repo.getRepoById(repoId))!;
    const lifecycle = createGenerationLifecycle({
      repo,
      index: { currentUsableIndex: async () => ({ sourceSha: SHA, indexedAt: new Date(), indexerVersion: 1, indexStatus: 'full' }) },
      capture: { capture: async () => ({ kind: 'captured', evidence: evidence() }) },
      generate: createGenerateTour({
        model: { generate: async () => ({ output: model(), rawBytes: 10, model: 'm', tokensIn: 1, tokensOut: 1, costUsd: null }) },
        clock: { now: () => new Date() },
      }),
      scheduler: { enqueue: async () => {} },
      settings: { publicOrigin: null, localOrigin: 'http://x', autoGenerate: true, dailyBudget: 99, retainedVersions: 5 },
      clock: { now: () => new Date() },
      log: { info: () => {}, warn: () => {} },
      newNonce: () => crypto.randomUUID(),
    });
    const r = await lifecycle.requestManual({ repo: rec, userId: ownerId });
    expect(await lifecycle.run(r.requestId)).toBe('published');
  }

  it('registers the job handler and the index-completion listener', () => {
    expect(handlers.has('onboarding_generate')).toBe(true);
    expect(indexListeners.length).toBe(1);
  });

  it('GET state is read-only and conforms to the contract (no tour yet)', async () => {
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/onboarding-tour`, headers: h(ownerId) });
    expect(res.statusCode).toBe(200);
    const body = OnboardingTourState.parse(res.json());
    expect(body.availability).toBe('no_tour');
    expect(body.permissions.can_regenerate).toBe(true);
    expect(jobs).toHaveLength(0); // a GET never enqueues
  });

  it('validates params (422) and hides unknown repos (404)', async () => {
    expect((await app.inject({ method: 'GET', url: '/repos/not-a-uuid/onboarding-tour' })).statusCode).toBe(422);
    const res = await app.inject({ method: 'GET', url: `/repos/${crypto.randomUUID()}/onboarding-tour`, headers: h(ownerId) });
    expect(res.statusCode).toBe(404);
  });

  it('regenerate: non-owner 403, owner 202 and queued job', async () => {
    const denied = await app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding-tour/regenerate`, headers: h(otherId) });
    expect(denied.statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding-tour/regenerate`, headers: h(ownerId) });
    expect(ok.statusCode).toBe(202);
    expect(ok.json().status).toBe('queued');
    expect(jobs.at(-1)?.kind).toBe('onboarding_generate');
  });

  it('share flow: create once, list without token, public read headers, revoke, generic 404', async () => {
    await publishOne();
    const state = (await app.inject({ method: 'GET', url: `/repos/${repoId}/onboarding-tour`, headers: h(ownerId) })).json();
    const tourId = state.tour.tour_id as string;

    const denied = await app.inject({
      method: 'POST', url: `/repos/${repoId}/onboarding-tour/shares`, headers: h(otherId), payload: { tour_id: tourId },
    });
    expect(denied.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST', url: `/repos/${repoId}/onboarding-tour/shares`, headers: h(ownerId), payload: { tour_id: tourId },
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers['cache-control']).toBe('no-store');
    const { url, share_id } = created.json() as { url: string; share_id: string };
    const token = url.split('/').pop()!;

    const listed = await app.inject({ method: 'GET', url: `/repos/${repoId}/onboarding-tour/shares`, headers: h(ownerId) });
    expect(listed.statusCode).toBe(200);
    expect(listed.body).not.toContain(token);

    // Anonymous read: no auth header at all.
    const pub = await app.inject({ method: 'GET', url: `/public/onboarding/${token}` });
    expect(pub.statusCode).toBe(200);
    expect(pub.headers['cache-control']).toBe('no-store');
    expect(pub.headers['referrer-policy']).toBe('no-referrer');
    expect(pub.body).not.toMatch(/created_by|workspace|clone_path|"repo_id"/);

    const revokeDenied = await app.inject({ method: 'DELETE', url: `/repos/${repoId}/onboarding-tour/shares/${share_id}`, headers: h(otherId) });
    expect(revokeDenied.statusCode).toBe(403);
    const revoked = await app.inject({ method: 'DELETE', url: `/repos/${repoId}/onboarding-tour/shares/${share_id}`, headers: h(ownerId) });
    expect(revoked.statusCode).toBe(200);

    for (const bad of [token, 'short', 'z'.repeat(43), '../etc/passwd']) {
      const r = await app.inject({ method: 'GET', url: `/public/onboarding/${encodeURIComponent(bad)}` });
      expect(r.statusCode, bad).toBe(404);
      expect(r.headers['cache-control']).toBe('no-store');
    }
  });

  it('rejects an unknown body shape for share creation (422)', async () => {
    const res = await app.inject({
      method: 'POST', url: `/repos/${repoId}/onboarding-tour/shares`, headers: h(ownerId), payload: { tour_id: 'nope' },
    });
    expect(res.statusCode).toBe(422);
  });
});
