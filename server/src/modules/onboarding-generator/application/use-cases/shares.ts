import type {
  PublicOnboardingSnapshot,
  ShareCreated,
  ShareList,
  ShareRevoked,
} from '@devdigest/shared/contracts/onboarding-generator.js';
import { OnboardingError } from '../errors.js';
import type { Clock, OnboardingSettings, ShareTokens, TourRepository } from '../ports/onboarding-ports.js';
import { ownerStatus } from './tour-state.js';

export interface ShareDeps {
  repo: TourRepository;
  tokens: ShareTokens;
  settings: OnboardingSettings;
  clock: Clock;
}

/** Share links point at the app's configured PUBLIC origin — never a request Host header. */
export function shareUrl(settings: Pick<OnboardingSettings, 'publicOrigin' | 'localOrigin'>, token: string): string {
  const origin = settings.publicOrigin ?? settings.localOrigin;
  return `${origin.replace(/\/+$/, '')}/share/onboarding/${token}`;
}

export function createShareUseCases(deps: ShareDeps) {
  async function requireOwnedRepo(workspaceId: string, userId: string, repoId: string) {
    const repo = await deps.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new OnboardingError('not_found', 'Repo not found');
    const owner = ownerStatus(repo, userId);
    if (!owner.isOwner) {
      throw new OnboardingError(
        'forbidden',
        owner.deniedReason === 'owner_unassigned'
          ? 'This repository has no assigned owner, so sharing is unavailable.'
          : 'Only the repository owner can manage share links.',
      );
    }
    return repo;
  }

  /** AC-24: snapshot of the DISPLAYED version (by id), never "whatever is latest". */
  async function create(workspaceId: string, userId: string, repoId: string, tourId: string): Promise<ShareCreated> {
    const repo = await requireOwnedRepo(workspaceId, userId, repoId);
    const { token, digest } = deps.tokens.create();
    const share = await deps.repo.createShare({ repo, tourId, createdBy: userId, tokenDigest: digest });
    if (!share) throw new OnboardingError('not_found', 'Tour version not found for this repository');
    return {
      share_id: share.id,
      tour_id: tourId,
      url: shareUrl(deps.settings, token),
      local_only: deps.settings.publicOrigin === null,
      created_at: share.createdAt.toISOString(),
    };
  }

  /** Owner-visible metadata only — the raw token is never recoverable after creation. */
  async function list(workspaceId: string, userId: string, repoId: string): Promise<ShareList> {
    await requireOwnedRepo(workspaceId, userId, repoId);
    const shares = await deps.repo.listShares(repoId);
    return {
      shares: shares.map((s) => ({
        share_id: s.id,
        tour_id: s.tourId,
        source_sha: s.sourceSha,
        created_at: s.createdAt.toISOString(),
        revoked_at: s.revokedAt?.toISOString() ?? null,
        created_by_me: s.createdBy === userId,
      })),
    };
  }

  /** AC-27/AC-30: only the snapshot's creator may revoke; foreign/missing ids are 404. */
  async function revoke(workspaceId: string, userId: string, repoId: string, shareId: string): Promise<ShareRevoked> {
    await requireOwnedRepo(workspaceId, userId, repoId);
    const outcome = await deps.repo.revokeShare({ repoId, shareId, userId, now: deps.clock.now() });
    if (outcome.kind === 'not_found') throw new OnboardingError('not_found', 'Share not found');
    if (outcome.kind === 'forbidden') {
      throw new OnboardingError('forbidden', 'Only the user who created this share can revoke it.');
    }
    return { share_id: shareId, revoked_at: outcome.revokedAt.toISOString() };
  }

  /**
   * The only anonymous read. Looks up by token DIGEST; invalid and revoked tokens
   * are indistinguishable (generic not_found) and reveal nothing private (AC-28).
   */
  async function readPublic(token: string): Promise<PublicOnboardingSnapshot> {
    const snapshot = await deps.repo.getSnapshotByDigest(deps.tokens.digest(token));
    if (!snapshot) throw new OnboardingError('not_found', 'This link is not available.');
    return {
      repository: { provider: 'github', full_name: snapshot.repoFullName },
      content: snapshot.content,
      provenance: snapshot.provenance,
      shared_at: snapshot.sharedAt.toISOString(),
    };
  }

  return { create, list, revoke, readPublic };
}

export type ShareUseCases = ReturnType<typeof createShareUseCases>;
