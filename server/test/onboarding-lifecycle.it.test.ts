import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { dockerAvailable, startPg, type PgFixture } from './helpers/pg.js';
import { SHA, evidence, model } from './helpers/onboarding-fixtures.js';
import * as t from '../src/db/schema.js';
import { OnboardingRepository } from '../src/modules/onboarding-generator/adapters/outbound/persistence/repository.js';
import { CryptoShareTokens } from '../src/modules/onboarding-generator/adapters/outbound/providers/share-tokens.js';
import { createGenerateTour } from '../src/modules/onboarding-generator/application/use-cases/generate-tour.js';
import { createGenerationLifecycle } from '../src/modules/onboarding-generator/application/use-cases/generation-lifecycle.js';
import { createRegenerate } from '../src/modules/onboarding-generator/application/use-cases/regenerate.js';
import { createShareUseCases } from '../src/modules/onboarding-generator/application/use-cases/shares.js';
import { createGetTourState } from '../src/modules/onboarding-generator/application/use-cases/tour-state.js';
import { OnboardingError } from '../src/modules/onboarding-generator/application/errors.js';
import { GenerationFailure } from '../src/modules/onboarding-generator/domain/lifecycle.js';
import type {
  CurrentIndex,
  OnboardingSettings,
  RepoRecord,
  TourModel,
} from '../src/modules/onboarding-generator/application/ports/onboarding-ports.js';

const hasDb = await dockerAvailable();
const d = hasDb ? describe : describe.skip;

d('onboarding generator lifecycle (real Postgres)', () => {
  let pg: PgFixture;
  let repoRepo: OnboardingRepository;
  let workspaceId = '';
  let ownerId = '';
  let otherId = '';
  let repo: RepoRecord;

  let currentIndex: CurrentIndex | null;
  let clockNow = new Date('2026-10-11T12:00:00Z');
  let modelImpl: TourModel['generate'];
  const enqueued: string[] = [];
  const settings: OnboardingSettings = {
    publicOrigin: 'https://app.example.com',
    localOrigin: 'http://localhost:3005',
    autoGenerate: true,
    dailyBudget: 4,
    retainedVersions: 2,
  };
  const clock = { now: () => clockNow };
  let nonce = 0;

  function build(over: Partial<OnboardingSettings> = {}) {
    const s = { ...settings, ...over };
    const index = { currentUsableIndex: async () => currentIndex };
    const capture = {
      capture: async () => ({ kind: 'captured' as const, evidence: evidence({ sourceSha: currentIndex?.sourceSha ?? SHA }) }),
    };
    const tourModel: TourModel = { generate: (i) => modelImpl(i) };
    const lifecycle = createGenerationLifecycle({
      repo: repoRepo,
      index,
      capture,
      generate: createGenerateTour({ model: tourModel, clock }),
      scheduler: { enqueue: async (_w, id) => void enqueued.push(id) },
      settings: s,
      clock,
      log: { info: () => {}, warn: () => {} },
      newNonce: () => `n${(nonce += 1)}`,
    });
    return {
      lifecycle,
      regenerate: createRegenerate({ repo: repoRepo, lifecycle }),
      getState: createGetTourState({ repo: repoRepo, index, settings: s, clock }),
      shares: createShareUseCases({ repo: repoRepo, tokens: new CryptoShareTokens(), settings: s, clock }),
    };
  }

  const okModel = (): TourModel['generate'] => async () => ({
    output: model(),
    rawBytes: 1000,
    model: 'test-model',
    tokensIn: 100,
    tokensOut: 50,
    costUsd: 0.01,
  });

  beforeAll(async () => {
    pg = await startPg();
    const db = pg.handle.db;
    const sfx = Math.random().toString(36).slice(2, 8);
    const [ws] = await db.insert(t.workspaces).values({ name: `onb-${sfx}` }).returning();
    workspaceId = ws!.id;
    const [u1] = await db.insert(t.users).values({ email: `o-${sfx}@t.dev`, name: 'Owner' }).returning();
    const [u2] = await db.insert(t.users).values({ email: `x-${sfx}@t.dev`, name: 'Other' }).returning();
    ownerId = u1!.id;
    otherId = u2!.id;
    const [r] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: `pay-${sfx}`, fullName: `acme/pay-${sfx}`, clonePath: '/tmp/x', createdBy: ownerId })
      .returning();
    repo = { id: r!.id, workspaceId, owner: 'acme', name: r!.name, fullName: r!.fullName, clonePath: '/tmp/x', createdBy: ownerId };
    repoRepo = new OnboardingRepository(db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const setIndex = (sha: string, v = 1) =>
    (currentIndex = { sourceSha: sha, indexedAt: new Date('2026-10-11T11:00:00Z'), indexerVersion: v, indexStatus: 'full' });

  it('reports index_required without a usable index, and does nothing automatically', async () => {
    currentIndex = null;
    modelImpl = okModel();
    const s = build();
    const st = await s.getState(workspaceId, ownerId, repo.id);
    expect(st.availability).toBe('index_required');
    await s.lifecycle.scheduleAfterIndex(repo.id);
    expect((await repoRepo.getState(repo.id)).currentRequest).toBeNull();
  });

  it('generates automatically once, de-duplicating the same index identity', async () => {
    setIndex(SHA);
    modelImpl = okModel();
    const s = build();
    enqueued.length = 0;
    await s.lifecycle.scheduleAfterIndex(repo.id);
    await s.lifecycle.scheduleAfterIndex(repo.id); // duplicate identity
    expect(enqueued).toHaveLength(1);
    expect(await s.lifecycle.run(enqueued[0]!)).toBe('published');
    const st = await s.getState(workspaceId, ownerId, repo.id);
    expect(st.availability).toBe('ready');
    expect(st.tour?.provenance.source_sha).toBe(SHA);
    expect(st.stale).toBe(false);
    // Running the same (now succeeded) request again is a no-op.
    expect(await s.lifecycle.run(enqueued[0]!)).toBe('skipped');
  });

  it('a failed manual regeneration keeps the previous success and reports a safe category', async () => {
    modelImpl = async () => {
      throw new GenerationFailure('provider_failure', 'secret provider body');
    };
    const s = build();
    const before = (await s.getState(workspaceId, ownerId, repo.id)).tour!.tour_id;
    enqueued.length = 0;
    const accepted = await s.regenerate(workspaceId, ownerId, repo.id);
    expect(accepted.status).toBe('queued');
    expect(await s.lifecycle.run(accepted.requestId)).toBe('failed');
    const st = await s.getState(workspaceId, ownerId, repo.id);
    expect(st.tour?.tour_id).toBe(before);
    expect(st.generation.status).toBe('failed');
    expect(st.generation.error_category).toBe('provider_failure');
    expect(JSON.stringify(st)).not.toContain('secret provider body');
  });

  it('enforces owner-only regenerate; null owner is unavailable', async () => {
    const s = build();
    await expect(s.regenerate(workspaceId, otherId, repo.id)).rejects.toMatchObject({ kind: 'forbidden' });
    const st = await s.getState(workspaceId, otherId, repo.id);
    expect(st.permissions).toMatchObject({ can_regenerate: false, can_share: false, denied_reason: 'not_owner' });
    await expect(s.regenerate(crypto.randomUUID(), ownerId, repo.id)).rejects.toBeInstanceOf(OnboardingError);
  });

  it('supersedes an active request and discards a late completion (fencing)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    modelImpl = async (i) => {
      await gate;
      return okModel()(i);
    };
    const s = build();
    const first = await s.regenerate(workspaceId, ownerId, repo.id);
    const running = s.lifecycle.run(first.requestId); // claims, then blocks in the model
    await new Promise((r) => setTimeout(r, 100));
    modelImpl = okModel();
    const second = await s.regenerate(workspaceId, ownerId, repo.id); // supersedes `first`
    release();
    expect(await running).toBe('discarded');
    expect(await s.lifecycle.run(second.requestId)).toBe('published');
    const st = await s.getState(workspaceId, ownerId, repo.id);
    expect(st.generation.status).toBe('idle');
  });

  it('enforces the daily budget with a clear state and 429-type error', async () => {
    modelImpl = okModel();
    const s = build({ dailyBudget: 1 });
    await expect(s.regenerate(workspaceId, ownerId, repo.id)).rejects.toMatchObject({ kind: 'rate_limited' });
    const st = await s.getState(workspaceId, ownerId, repo.id);
    // Tour exists and is fresh, so the state stays idle; budget shows once a regeneration is needed.
    expect(['idle', 'budget_reached']).toContain(st.generation.status);
  });

  it('marks the tour stale when the index moves on, and retention keeps the latest N', async () => {
    setIndex('b'.repeat(40), 2);
    const s = build({ dailyBudget: 50 });
    const st = await s.getState(workspaceId, ownerId, repo.id);
    expect(st.stale).toBe(true);
    for (let i = 0; i < 3; i += 1) {
      modelImpl = okModel();
      const r = await s.regenerate(workspaceId, ownerId, repo.id);
      expect(await s.lifecycle.run(r.requestId)).toBe('published');
    }
    const versions = await pg.handle.db
      .select({ id: t.onboardingTourVersions.id })
      .from(t.onboardingTourVersions)
      .where(eq(t.onboardingTourVersions.repoId, repo.id));
    expect(versions.length).toBe(settings.retainedVersions);
  });

  it('shares an immutable snapshot, hides the token, and revokes', async () => {
    const s = build({ dailyBudget: 50 });
    const st = await s.getState(workspaceId, ownerId, repo.id);
    const created = await s.shares.create(workspaceId, ownerId, repo.id, st.tour!.tour_id);
    expect(created.url).toMatch(/^https:\/\/app\.example\.com\/share\/onboarding\/[A-Za-z0-9_-]{43}$/);
    expect(created.local_only).toBe(false);
    const token = created.url.split('/').pop()!;

    const pub = await s.shares.readPublic(token);
    expect(pub.repository.full_name).toBe(repo.fullName);
    expect(JSON.stringify(pub)).not.toMatch(/created_by|repo_id|tour_id|clone/);

    // Raw token is never stored.
    const rows = await pg.handle.db.select().from(t.onboardingShares).where(eq(t.onboardingShares.repoId, repo.id));
    expect(JSON.stringify(rows)).not.toContain(token);

    // Non-owners cannot create/list/revoke.
    await expect(s.shares.create(workspaceId, otherId, repo.id, st.tour!.tour_id)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(s.shares.list(workspaceId, otherId, repo.id)).rejects.toMatchObject({ kind: 'forbidden' });
    const listed = await s.shares.list(workspaceId, ownerId, repo.id);
    expect(listed.shares[0]).toMatchObject({ share_id: created.share_id, revoked_at: null, created_by_me: true });

    // Regeneration + retention must not alter the snapshot.
    modelImpl = okModel();
    const r = await s.regenerate(workspaceId, ownerId, repo.id);
    await s.lifecycle.run(r.requestId);
    expect((await s.shares.readPublic(token)).content).toEqual(pub.content);

    await s.shares.revoke(workspaceId, ownerId, repo.id, created.share_id);
    await expect(s.shares.readPublic(token)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(s.shares.readPublic('z'.repeat(43))).rejects.toMatchObject({ kind: 'not_found' });
    // Foreign tour ids are not shareable.
    await expect(s.shares.create(workspaceId, ownerId, repo.id, crypto.randomUUID())).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('reconciliation requeues expired leases without mass-generating', async () => {
    const s = build({ dailyBudget: 50 });
    modelImpl = okModel();
    const r = await s.regenerate(workspaceId, ownerId, repo.id);
    const claim = await repoRepo.claim(r.requestId, new Date('2026-10-11T12:00:00Z'), 1_000);
    expect(claim).not.toBeNull();
    clockNow = new Date('2026-10-11T13:00:00Z'); // lease long expired
    enqueued.length = 0;
    const res = await s.lifecycle.reconcile();
    expect(res.requeued).toBe(1);
    expect(enqueued).toContain(r.requestId);
    expect(await s.lifecycle.run(r.requestId)).toBe('published');
  });
});
