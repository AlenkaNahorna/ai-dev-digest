import type {
  GenerationState,
  OnboardingTourState,
  OnboardingTourVersion,
} from '@devdigest/shared/contracts/onboarding-generator.js';
import { BUDGET_WINDOW_MS } from '../../domain/limits.js';
import { BUDGET_REACHED_MESSAGE, SAFE_ERROR_MESSAGES, isActiveStatus } from '../../domain/lifecycle.js';
import { OnboardingError } from '../errors.js';
import type {
  Clock,
  IndexReader,
  OnboardingSettings,
  RepoRecord,
  RequestRecord,
  StoredTour,
  TourRepository,
} from '../ports/onboarding-ports.js';

/** Owner = `repos.created_by` (explicit assumption — see plan Step 4). Null owners never match. */
export function ownerStatus(repo: RepoRecord, userId: string): { isOwner: boolean; deniedReason: 'not_owner' | 'owner_unassigned' | null } {
  if (repo.createdBy === null) return { isOwner: false, deniedReason: 'owner_unassigned' };
  if (repo.createdBy === userId) return { isOwner: true, deniedReason: null };
  return { isOwner: false, deniedReason: 'not_owner' };
}

export function toVersionDto(t: StoredTour): OnboardingTourVersion {
  return { tour_id: t.id, repo_id: t.repoId, content: t.content, provenance: t.provenance };
}

function generationFrom(request: RequestRecord | null): GenerationState {
  if (!request || !isActiveStatus(request.status) && request.status !== 'failed') {
    return { status: 'idle', request_id: request?.id ?? null, trigger: request?.trigger ?? null, requested_at: request?.createdAt.toISOString() ?? null, error_category: null, message: null };
  }
  if (request.status === 'failed') {
    const category = request.errorCategory ?? 'internal';
    return {
      status: 'failed',
      request_id: request.id,
      trigger: request.trigger,
      requested_at: request.createdAt.toISOString(),
      error_category: category,
      message: SAFE_ERROR_MESSAGES[category],
    };
  }
  return {
    status: request.status === 'running' ? 'running' : 'queued',
    request_id: request.id,
    trigger: request.trigger,
    requested_at: request.createdAt.toISOString(),
    error_category: null,
    message: null,
  };
}

export interface TourStateDeps {
  repo: TourRepository;
  index: IndexReader;
  settings: OnboardingSettings;
  clock: Clock;
}

/**
 * GET state (AC-1/3/6/8/9/21/23/32). Reads persisted data and a cheap index probe
 * only — it never calls an LLM, never enqueues work and never captures evidence.
 */
export function createGetTourState(deps: TourStateDeps) {
  return async function getTourState(
    workspaceId: string,
    userId: string,
    repoId: string,
  ): Promise<OnboardingTourState> {
    const repo = await deps.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new OnboardingError('not_found', 'Repo not found');

    const [state, idx] = await Promise.all([deps.repo.getState(repoId), deps.index.currentUsableIndex(repoId)]);
    const tour = state.latestTour;
    const stale = tour !== null && idx !== null && idx.sourceSha !== tour.provenance.source_sha;

    let generation = generationFrom(state.currentRequest);
    const active = state.currentRequest ? isActiveStatus(state.currentRequest.status) : false;
    if (!active && generation.status !== 'failed' && (tour === null || stale) && idx !== null) {
      const since = new Date(deps.clock.now().getTime() - BUDGET_WINDOW_MS);
      if ((await deps.repo.countRequestsSince(repoId, since)) >= deps.settings.dailyBudget) {
        generation = {
          status: 'budget_reached',
          request_id: null,
          trigger: null,
          requested_at: null,
          error_category: null,
          message: BUDGET_REACHED_MESSAGE,
        };
      }
    }

    const owner = ownerStatus(repo, userId);
    return {
      repo_id: repoId,
      availability: tour ? 'ready' : idx ? 'no_tour' : 'index_required',
      current_index: idx
        ? { source_sha: idx.sourceSha, indexed_at: idx.indexedAt.toISOString(), index_status: idx.indexStatus }
        : null,
      tour: tour ? toVersionDto(tour) : null,
      stale,
      generation,
      permissions: {
        can_regenerate: owner.isOwner,
        can_share: owner.isOwner && tour !== null,
        denied_reason: owner.deniedReason,
      },
      public_origin_configured: deps.settings.publicOrigin !== null,
    };
  };
}
