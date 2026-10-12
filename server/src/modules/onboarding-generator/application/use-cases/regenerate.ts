import { OnboardingError } from '../errors.js';
import type { TourRepository } from '../ports/onboarding-ports.js';
import type { GenerationLifecycle } from './generation-lifecycle.js';
import { ownerStatus } from './tour-state.js';

/** Owner-only manual Generate/Regenerate (AC-4/AC-23). Never runs a model inline. */
export function createRegenerate(deps: { repo: TourRepository; lifecycle: GenerationLifecycle }) {
  return async function regenerate(workspaceId: string, userId: string, repoId: string) {
    const repo = await deps.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new OnboardingError('not_found', 'Repo not found');
    const owner = ownerStatus(repo, userId);
    if (!owner.isOwner) {
      throw new OnboardingError(
        'forbidden',
        owner.deniedReason === 'owner_unassigned'
          ? 'This repository has no assigned owner, so regeneration is unavailable.'
          : 'Only the repository owner can regenerate the tour.',
      );
    }
    return deps.lifecycle.requestManual({ repo, userId });
  };
}
