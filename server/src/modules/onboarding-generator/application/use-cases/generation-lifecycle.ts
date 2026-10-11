import { BUDGET_WINDOW_MS, GENERATION_TIMING } from '../../domain/limits.js';
import {
  BUDGET_REACHED_MESSAGE,
  GenerationFailure,
  automaticIdentityKey,
  manualIdentityKey,
} from '../../domain/lifecycle.js';
import { OnboardingError } from '../errors.js';
import type {
  Clock,
  EvidenceCapture,
  IndexReader,
  JobScheduler,
  OnboardingLogger,
  OnboardingSettings,
  RepoRecord,
  TourRepository,
} from '../ports/onboarding-ports.js';
import type { GenerateTour } from './generate-tour.js';

/**
 * Step 3b/3c — durable request lifecycle, scheduling and the worker.
 *
 * Invariants:
 *  - a request row is persisted BEFORE anything is enqueued (an enqueue failure
 *    is recoverable: boot reconciliation resumes queued requests);
 *  - every worker write is fenced by (request id, attempt token, lease);
 *  - generation failure never fails indexing and never touches the last success.
 */
export interface LifecycleDeps {
  repo: TourRepository;
  index: IndexReader;
  capture: EvidenceCapture;
  generate: GenerateTour;
  scheduler: JobScheduler;
  settings: OnboardingSettings;
  clock: Clock;
  log: OnboardingLogger;
  newNonce: () => string;
}

export type RunOutcome = 'published' | 'failed' | 'discarded' | 'skipped';

/** Race `work` against a deadline; a late completion is left running but fenced out at publish. */
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new GenerationFailure('timeout', `deadline ${ms}ms`)), ms);
    (timer as { unref?: () => void }).unref?.();
  });
  // A late rejection of the abandoned work must never become an unhandled rejection.
  work.catch(() => undefined);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createGenerationLifecycle(deps: LifecycleDeps) {
  const { repo, index, capture, generate, scheduler, settings, clock, log } = deps;

  async function enqueueSafely(workspaceId: string, requestId: string): Promise<void> {
    try {
      await scheduler.enqueue(workspaceId, requestId);
    } catch (err) {
      // The request row is already durable: reconciliation (boot) or a newer request recovers it.
      log.warn({ requestId, err: (err as Error).message }, 'onboarding: enqueue failed; request stays queued');
    }
  }

  /**
   * Manual Regenerate/Generate (owner-only is enforced by the caller). Requires a
   * usable index; supersedes any active request; respects the daily budget.
   */
  async function requestManual(input: { repo: RepoRecord; userId: string }) {
    const idx = await index.currentUsableIndex(input.repo.id);
    if (!idx) {
      throw new OnboardingError(
        'unavailable',
        'The repository has no usable index yet. Index it first, then generate the tour.',
      );
    }
    const now = clock.now();
    const outcome = await repo.createRequest({
      repo: input.repo,
      trigger: 'manual',
      requestedBy: input.userId,
      identityKey: manualIdentityKey(idx, deps.newNonce()),
      dailyBudget: settings.dailyBudget,
      windowStart: new Date(now.getTime() - BUDGET_WINDOW_MS),
    });
    if (outcome.kind === 'budget_reached') throw new OnboardingError('rate_limited', BUDGET_REACHED_MESSAGE);
    if (outcome.kind === 'duplicate') {
      // Manual requests are never deduplicated; defensive for adapter bugs.
      throw new OnboardingError('conflict', 'A generation request for this revision already exists.');
    }
    await enqueueSafely(input.repo.workspaceId, outcome.request.id);
    return { requestId: outcome.request.id, status: 'queued' as const };
  }

  /**
   * Automatic generation after a usable index completes (AC-2). Never throws —
   * generation must not turn a successful index into a failed one.
   */
  async function scheduleAfterIndex(repoId: string): Promise<void> {
    try {
      if (!settings.autoGenerate) return;
      const target = await repo.getRepoById(repoId);
      if (!target) return;
      const idx = await index.currentUsableIndex(repoId);
      if (!idx) return; // no usable evidence: nothing to generate (AC-3 covers the UI)
      const now = clock.now();
      const outcome = await repo.createRequest({
        repo: target,
        trigger: 'automatic',
        requestedBy: null,
        identityKey: automaticIdentityKey(idx),
        dailyBudget: settings.dailyBudget,
        windowStart: new Date(now.getTime() - BUDGET_WINDOW_MS),
      });
      if (outcome.kind === 'created') await enqueueSafely(target.workspaceId, outcome.request.id);
      else log.info({ repoId, outcome: outcome.kind }, 'onboarding: automatic generation skipped');
    } catch (err) {
      log.warn({ repoId, err: (err as Error).message }, 'onboarding: scheduling after index failed (non-fatal)');
    }
  }

  /** The worker: claim → capture → generate → fenced publish. Never throws. */
  async function run(requestId: string): Promise<RunOutcome> {
    const request = await repo.getRequest(requestId);
    if (!request || request.status !== 'queued') return 'skipped';

    const claim = await repo.claim(requestId, clock.now(), GENERATION_TIMING.leaseMs);
    if (!claim) return 'skipped'; // superseded or taken by another worker
    const attemptToken = claim.attemptToken;

    const fail = async (category: Parameters<typeof repo.publishFailure>[0]['category']): Promise<RunOutcome> => {
      const written = await repo.publishFailure({ requestId, attemptToken, now: clock.now(), category });
      return written ? 'failed' : 'discarded';
    };

    try {
      const target = await repo.getRepoById(request.repoId);
      if (!target) return await fail('internal');

      const attempt = (async (): Promise<RunOutcome> => {
        const captured = await capture.capture(target);
        if (captured.kind === 'unavailable') throw new GenerationFailure('evidence_unavailable', captured.reason);
        const result = await generate(target.workspaceId, captured.evidence);
        const published = await repo.publishSuccess({
          requestId,
          attemptToken,
          now: clock.now(),
          content: result.content,
          provenance: result.provenance,
          model: result.model,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          costUsd: result.costUsd,
          retainVersions: settings.retainedVersions,
        });
        // null = superseded / timed out / lease lost: the older result is discarded.
        return published ? 'published' : 'discarded';
      })();

      // Leave a margin inside the lease so a timed-out attempt records its failure while it still owns the token.
      return await withDeadline(attempt, GENERATION_TIMING.leaseMs - 5_000);
    } catch (err) {
      const category = err instanceof GenerationFailure ? err.category : 'internal';
      // Redacted log: category + short internal detail only — never prompts, documents or provider bodies.
      log.warn(
        { requestId, category, detail: err instanceof GenerationFailure ? err.detail : undefined },
        'onboarding: generation failed',
      );
      try {
        return await fail(category);
      } catch (writeErr) {
        log.warn({ requestId, err: (writeErr as Error).message }, 'onboarding: failure write failed');
        return 'failed';
      }
    }
  }

  /**
   * Boot reconciliation (never during GET): reclaim expired leases and resume
   * every current request that is still queued. Does NOT mass-enqueue
   * generation for repositories that never had a request (cost control).
   */
  async function reconcile(): Promise<{ requeued: number; resumed: number }> {
    const requeued = await repo.reclaimExpired(clock.now());
    const queued = await repo.listQueuedCurrent();
    for (const r of queued) await enqueueSafely(r.workspaceId, r.id);
    return { requeued: requeued.length, resumed: queued.length };
  }

  return { requestManual, scheduleAfterIndex, run, reconcile };
}

export type GenerationLifecycle = ReturnType<typeof createGenerationLifecycle>;
