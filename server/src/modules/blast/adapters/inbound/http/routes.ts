import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { BlastRadius } from '@devdigest/shared';
import { getContext } from '../../../../_shared/context.js';
import { IdParams } from '../../../../_shared/schemas.js';
import { responseSchemas } from '../../../../_shared/response-schemas.js';
import { NotFoundError } from '../../../../../platform/errors.js';
import { createGetBlastRadius } from '../../../application/use-cases/get-blast-radius.js';
import { BlastRepository } from '../../outbound/persistence/repository.js';

/**
 * Blast radius routes.
 *
 *   GET /pulls/:id/blast → what else in the repo a PR can touch (pure read, no LLM)
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/pulls/:id/blast', { schema: { params: IdParams, response: { 200: responseSchemas.blast } } }, async (req): Promise<BlastRadius> => {
    const { workspaceId } = await getContext(container, req);
    const getBlastRadius = createGetBlastRadius({
      files: new BlastRepository(container.db),
      // Resolved per call so test overrides of `container.repoIntel` apply.
      intel: { getBlastRadius: (repoId, changedFiles) => container.repoIntel.getBlastRadius(repoId, changedFiles) },
    });
    const result = await getBlastRadius(workspaceId, req.params.id);
    if (!result) throw new NotFoundError('Pull request not found');
    return result;
  });
}
