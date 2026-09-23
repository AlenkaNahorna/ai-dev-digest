import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../../../../_shared/context.js';
import { IdParams } from '../../../../_shared/schemas.js';
import { NotFoundError } from '../../../../../platform/errors.js';
import { PollingRepository } from '../../outbound/persistence/repository.js';

/**
 * F1 — polling module. MANUAL refresh that ONLY syncs the PR list
 * (new/updated PRs appear, head_sha updates). It does NOT trigger any review —
 * review is manual (user presses Run Review, owned by A2).
 *
 *   POST /repos/:id/poll  → sync PR list from GitHub, bump last_polled_at
 */
export default async function pollingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const repository = new PollingRepository(container.db);

  app.post('/repos/:id/poll', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const repo = await repository.findRepo(workspaceId, req.params.id);
    if (!repo) throw new NotFoundError('Repo not found');

    const gh = await container.github();
    const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
    let synced = 0;
    await repository.syncPullRequests(workspaceId, repo.id, pulls);
    synced = pulls.length;
    await repository.touchRepo(repo.id);

    // NOTE: no review is triggered here — manual trigger only.
    return { synced, reviewTriggered: false };
  });
}
