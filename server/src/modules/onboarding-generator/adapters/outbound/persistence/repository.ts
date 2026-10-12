import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import {
  OnboardingTourContent,
  TourProvenance,
} from '@devdigest/shared/contracts/onboarding-generator.js';
import type { GenerationErrorCategory } from '@devdigest/shared/contracts/onboarding-generator.js';
import type { Db } from '../../../../../db/client.js';
import * as t from '../../../../../db/schema.js';
import type {
  CreateRequestOutcome,
  PublicSnapshotRecord,
  PublishFailureInput,
  PublishSuccessInput,
  RepoRecord,
  RepoStateRecord,
  RequestRecord,
  RevokeOutcome,
  ShareRecord,
  StoredTour,
  TourRepository,
} from '../../../application/ports/onboarding-ports.js';
import type { RequestStatus, RequestTrigger } from '../../../domain/lifecycle.js';

const MAX_ATTEMPTS = 3;
const UNIQUE_VIOLATION = '23505';

type RequestRow = typeof t.onboardingGenerationRequests.$inferSelect;
type VersionRow = typeof t.onboardingTourVersions.$inferSelect;
type ShareRow = typeof t.onboardingShares.$inferSelect;

function toRequest(r: RequestRow): RequestRecord {
  return {
    id: r.id,
    repoId: r.repoId,
    workspaceId: r.workspaceId,
    trigger: r.trigger as RequestTrigger,
    status: r.status as RequestStatus,
    identityKey: r.identityKey,
    attemptToken: r.attemptToken,
    errorCategory: (r.errorCategory as GenerationErrorCategory | null) ?? null,
    tourId: r.tourId,
    createdAt: r.createdAt,
  };
}

function toTour(v: VersionRow): StoredTour {
  return {
    id: v.id,
    repoId: v.repoId,
    // Re-validate persisted JSON at the read boundary (never trust stored blobs blindly).
    content: OnboardingTourContent.parse(v.content),
    provenance: TourProvenance.parse(v.provenance),
    createdAt: v.createdAt,
  };
}

function toShare(s: ShareRow): ShareRecord {
  const provenance = TourProvenance.safeParse(s.provenance);
  return {
    id: s.id,
    repoId: s.repoId,
    tourId: s.tourId,
    sourceSha: provenance.success ? provenance.data.source_sha : '0'.repeat(40),
    createdBy: s.createdBy,
    createdAt: s.createdAt,
    revokedAt: s.revokedAt,
  };
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === UNIQUE_VIOLATION || e?.cause?.code === UNIQUE_VIOLATION;
}

/**
 * SQL for the onboarding generator. Concurrency design:
 *  - lock order is ALWAYS repo-state row → request row (createRequest, publishSuccess),
 *    so supersession and publication can never deadlock each other;
 *  - publication and the latest-success pointer move in ONE transaction, conditioned
 *    on request identity + attempt token + lease (compare-and-set);
 *  - the pointer is separate from request status, so failed/pending work never
 *    touches the last successful tour.
 */
export class OnboardingRepository implements TourRepository {
  constructor(private readonly db: Db) {}

  private repoSelect = {
    id: t.repos.id,
    workspaceId: t.repos.workspaceId,
    owner: t.repos.owner,
    name: t.repos.name,
    fullName: t.repos.fullName,
    clonePath: t.repos.clonePath,
    createdBy: t.repos.createdBy,
  };

  async getRepo(workspaceId: string, repoId: string): Promise<RepoRecord | null> {
    const [row] = await this.db
      .select(this.repoSelect)
      .from(t.repos)
      .where(and(eq(t.repos.id, repoId), eq(t.repos.workspaceId, workspaceId)));
    return row ?? null;
  }

  async getRepoById(repoId: string): Promise<RepoRecord | null> {
    const [row] = await this.db.select(this.repoSelect).from(t.repos).where(eq(t.repos.id, repoId));
    return row ?? null;
  }

  async getState(repoId: string): Promise<RepoStateRecord> {
    const [state] = await this.db
      .select()
      .from(t.onboardingRepoState)
      .where(eq(t.onboardingRepoState.repoId, repoId));
    if (!state) return { latestTour: null, currentRequest: null };
    const [version] = state.latestTourId
      ? await this.db
          .select()
          .from(t.onboardingTourVersions)
          .where(eq(t.onboardingTourVersions.id, state.latestTourId))
      : [];
    const [request] = state.currentRequestId
      ? await this.db
          .select()
          .from(t.onboardingGenerationRequests)
          .where(eq(t.onboardingGenerationRequests.id, state.currentRequestId))
      : [];
    return {
      latestTour: version ? toTour(version) : null,
      currentRequest: request ? toRequest(request) : null,
    };
  }

  async createRequest(input: Parameters<TourRepository['createRequest']>[0]): Promise<CreateRequestOutcome> {
    const { repo, trigger, requestedBy, identityKey, dailyBudget, windowStart } = input;
    try {
      return await this.db.transaction(async (tx) => {
        // Serialize all request creation for this repository on its state row.
        await tx
          .insert(t.onboardingRepoState)
          .values({ repoId: repo.id, workspaceId: repo.workspaceId })
          .onConflictDoNothing();
        const [state] = await tx
          .select()
          .from(t.onboardingRepoState)
          .where(eq(t.onboardingRepoState.repoId, repo.id))
          .for('update');

        if (trigger === 'automatic') {
          const [dup] = await tx
            .select({ id: t.onboardingGenerationRequests.id })
            .from(t.onboardingGenerationRequests)
            .where(
              and(
                eq(t.onboardingGenerationRequests.repoId, repo.id),
                eq(t.onboardingGenerationRequests.identityKey, identityKey),
                eq(t.onboardingGenerationRequests.trigger, 'automatic'),
              ),
            );
          if (dup) return { kind: 'duplicate' } as const;
        }

        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(t.onboardingGenerationRequests)
          .where(
            and(
              eq(t.onboardingGenerationRequests.repoId, repo.id),
              gte(t.onboardingGenerationRequests.createdAt, windowStart),
            ),
          ) as [{ n: number }];
        if (n >= dailyBudget) return { kind: 'budget_reached' } as const;

        // A newer request supersedes any active current one (AC-10).
        if (state?.currentRequestId) {
          await tx
            .update(t.onboardingGenerationRequests)
            .set({ status: 'superseded', finishedAt: new Date() })
            .where(
              and(
                eq(t.onboardingGenerationRequests.id, state.currentRequestId),
                inArray(t.onboardingGenerationRequests.status, ['queued', 'running']),
              ),
            );
        }

        const [created] = await tx
          .insert(t.onboardingGenerationRequests)
          .values({
            repoId: repo.id,
            workspaceId: repo.workspaceId,
            trigger,
            requestedBy,
            status: 'queued',
            identityKey,
          })
          .returning();
        await tx
          .update(t.onboardingRepoState)
          .set({ currentRequestId: created!.id, updatedAt: new Date() })
          .where(eq(t.onboardingRepoState.repoId, repo.id));
        return { kind: 'created', request: toRequest(created!) } as const;
      });
    } catch (err) {
      // The partial unique index is the backstop for racing automatic requests.
      if (trigger === 'automatic' && isUniqueViolation(err)) return { kind: 'duplicate' };
      throw err;
    }
  }

  async getRequest(requestId: string): Promise<RequestRecord | null> {
    const [row] = await this.db
      .select()
      .from(t.onboardingGenerationRequests)
      .where(eq(t.onboardingGenerationRequests.id, requestId));
    return row ? toRequest(row) : null;
  }

  async countRequestsSince(repoId: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.onboardingGenerationRequests)
      .where(
        and(
          eq(t.onboardingGenerationRequests.repoId, repoId),
          gte(t.onboardingGenerationRequests.createdAt, since),
        ),
      );
    return row?.n ?? 0;
  }

  async claim(requestId: string, now: Date, leaseMs: number): Promise<{ attemptToken: string } | null> {
    const r = t.onboardingGenerationRequests;
    const s = t.onboardingRepoState;
    const [row] = await this.db
      .update(r)
      .set({
        status: 'running',
        attemptToken: sql`gen_random_uuid()`,
        attemptCount: sql`${r.attemptCount} + 1`,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        startedAt: now,
      })
      .where(
        and(
          eq(r.id, requestId),
          eq(r.status, 'queued'),
          // Only the repo's CURRENT request can run; a superseded one is never claimable.
          sql`exists (select 1 from ${s} where ${s.repoId} = ${r.repoId} and ${s.currentRequestId} = ${r.id})`,
        ),
      )
      .returning({ attemptToken: r.attemptToken });
    return row?.attemptToken ? { attemptToken: row.attemptToken } : null;
  }

  async publishSuccess(input: PublishSuccessInput): Promise<{ tourId: string } | null> {
    const r = t.onboardingGenerationRequests;
    const s = t.onboardingRepoState;
    const v = t.onboardingTourVersions;
    return this.db.transaction(async (tx) => {
      const [probe] = await tx.select({ repoId: r.repoId }).from(r).where(eq(r.id, input.requestId));
      if (!probe) return null;
      // Lock order: repo state, then request (same as createRequest).
      const [state] = await tx.select().from(s).where(eq(s.repoId, probe.repoId)).for('update');
      const [req] = await tx.select().from(r).where(eq(r.id, input.requestId)).for('update');
      if (
        !req ||
        !state ||
        state.currentRequestId !== req.id || // superseded by a newer request
        req.status !== 'running' ||
        req.attemptToken !== input.attemptToken || // a different (or previous-process) attempt
        !req.leaseExpiresAt ||
        req.leaseExpiresAt <= input.now // timed out: lease no longer valid
      ) {
        return null;
      }

      const [version] = await tx
        .insert(v)
        .values({
          repoId: req.repoId,
          workspaceId: req.workspaceId,
          content: input.content,
          provenance: input.provenance,
          sourceSha: input.provenance.source_sha,
          indexedAt: new Date(input.provenance.indexed_at),
          indexerVersion: input.provenance.indexer_version,
          indexStatus: input.provenance.index_status,
          model: input.model,
        })
        .returning({ id: v.id });
      const tourId = version!.id;

      await tx
        .update(r)
        .set({
          status: 'succeeded',
          tourId,
          errorCategory: null,
          finishedAt: input.now,
          model: input.model,
          tokensIn: input.tokensIn,
          tokensOut: input.tokensOut,
          costUsd: input.costUsd === null ? null : input.costUsd.toFixed(6),
        })
        .where(eq(r.id, req.id));
      await tx.update(s).set({ latestTourId: tourId, updatedAt: input.now }).where(eq(s.repoId, req.repoId));

      // Retention (same transaction): newest N versions + every version a share was made from.
      await tx.execute(sql`
        delete from ${v}
        where ${v.repoId} = ${req.repoId}
          and ${v.id} <> ${tourId}
          and ${v.id} not in (
            select id from ${v} where ${v.repoId} = ${req.repoId}
            order by ${v.createdAt} desc, ${v.id} desc limit ${input.retainVersions}
          )
          and not exists (select 1 from ${t.onboardingShares} sh where sh.tour_id = ${v.id})`);
      return { tourId };
    });
  }

  async publishFailure(input: PublishFailureInput): Promise<boolean> {
    const r = t.onboardingGenerationRequests;
    const rows = await this.db
      .update(r)
      .set({ status: 'failed', errorCategory: input.category, finishedAt: input.now })
      .where(and(eq(r.id, input.requestId), eq(r.status, 'running'), eq(r.attemptToken, input.attemptToken)))
      .returning({ id: r.id });
    return rows.length > 0;
  }

  async reclaimExpired(now: Date): Promise<string[]> {
    const r = t.onboardingGenerationRequests;
    const s = t.onboardingRepoState;
    return this.db.transaction(async (tx) => {
      // Anything still active that is no longer the repo's current request is obsolete.
      await tx
        .update(r)
        .set({ status: 'superseded', finishedAt: now })
        .where(
          and(
            inArray(r.status, ['queued', 'running']),
            sql`not exists (select 1 from ${s} where ${s.currentRequestId} = ${r.id})`,
          ),
        );
      // Over-retried requests fail instead of looping forever.
      await tx
        .update(r)
        .set({ status: 'failed', errorCategory: 'timeout', finishedAt: now })
        .where(and(eq(r.status, 'running'), lt(r.leaseExpiresAt, now), sql`${r.attemptCount} >= ${MAX_ATTEMPTS}`));
      const requeued = await tx
        .update(r)
        .set({ status: 'queued', attemptToken: null, leaseExpiresAt: null })
        .where(and(eq(r.status, 'running'), lt(r.leaseExpiresAt, now)))
        .returning({ id: r.id });
      return requeued.map((x) => x.id);
    });
  }

  async listQueuedCurrent(): Promise<RequestRecord[]> {
    const r = t.onboardingGenerationRequests;
    const s = t.onboardingRepoState;
    const rows = await this.db
      .select({ request: r })
      .from(r)
      .innerJoin(s, eq(s.currentRequestId, r.id))
      .where(eq(r.status, 'queued'));
    return rows.map((row) => toRequest(row.request));
  }

  // ------------------------------------------------------------------ shares

  async getTour(repoId: string, tourId: string): Promise<StoredTour | null> {
    const v = t.onboardingTourVersions;
    const [row] = await this.db.select().from(v).where(and(eq(v.id, tourId), eq(v.repoId, repoId)));
    return row ? toTour(row) : null;
  }

  async createShare(input: {
    repo: RepoRecord;
    tourId: string;
    createdBy: string;
    tokenDigest: string;
  }): Promise<ShareRecord | null> {
    const v = t.onboardingTourVersions;
    return this.db.transaction(async (tx) => {
      // Lock the source version so retention cannot prune it between read and insert.
      const [version] = await tx
        .select()
        .from(v)
        .where(and(eq(v.id, input.tourId), eq(v.repoId, input.repo.id), eq(v.workspaceId, input.repo.workspaceId)))
        .for('share');
      if (!version) return null;
      const [share] = await tx
        .insert(t.onboardingShares)
        .values({
          repoId: input.repo.id,
          workspaceId: input.repo.workspaceId,
          tourId: version.id,
          createdBy: input.createdBy,
          tokenDigest: input.tokenDigest,
          // Independent copy: later regeneration or pruning never changes a published snapshot.
          content: version.content,
          provenance: version.provenance,
          repoFullName: input.repo.fullName,
        })
        .returning();
      return toShare(share!);
    });
  }

  async listShares(repoId: string): Promise<ShareRecord[]> {
    const rows = await this.db
      .select()
      .from(t.onboardingShares)
      .where(eq(t.onboardingShares.repoId, repoId))
      .orderBy(desc(t.onboardingShares.createdAt));
    return rows.map(toShare);
  }

  async revokeShare(input: { repoId: string; shareId: string; userId: string; now: Date }): Promise<RevokeOutcome> {
    const sh = t.onboardingShares;
    const [row] = await this.db
      .select()
      .from(sh)
      .where(and(eq(sh.id, input.shareId), eq(sh.repoId, input.repoId)));
    if (!row) return { kind: 'not_found' };
    if (row.createdBy !== input.userId) return { kind: 'forbidden' };
    if (row.revokedAt) return { kind: 'revoked', revokedAt: row.revokedAt }; // idempotent
    const [updated] = await this.db
      .update(sh)
      .set({ revokedAt: input.now })
      .where(and(eq(sh.id, row.id), sql`${sh.revokedAt} is null`))
      .returning({ revokedAt: sh.revokedAt });
    return { kind: 'revoked', revokedAt: updated?.revokedAt ?? input.now };
  }

  async getSnapshotByDigest(digest: string): Promise<PublicSnapshotRecord | null> {
    const sh = t.onboardingShares;
    const [row] = await this.db
      .select()
      .from(sh)
      .where(and(eq(sh.tokenDigest, digest), sql`${sh.revokedAt} is null`));
    if (!row) return null;
    const content = OnboardingTourContent.safeParse(row.content);
    const provenance = TourProvenance.safeParse(row.provenance);
    // A snapshot that no longer parses is treated as unavailable rather than leaked raw.
    if (!content.success || !provenance.success) return null;
    return {
      repoFullName: row.repoFullName,
      content: content.data,
      provenance: provenance.data,
      sharedAt: row.createdAt,
    };
  }
}
