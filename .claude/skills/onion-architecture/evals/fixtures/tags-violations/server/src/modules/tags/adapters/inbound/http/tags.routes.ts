import type { FastifyPluginAsync } from 'fastify';
import { createAssignTag } from '../../../application/use-cases/assign-tag.js';
import type { Container } from '../../../../../platform/container.js';

export function createTagsRoutes(container: Container): FastifyPluginAsync {
  return async (app) => {
    const assignTag = createAssignTag(container);
    app.post('/pulls/:pullId/tags', async (request) => {
      const { pullId } = request.params as { pullId: string };
      const { name } = request.body as { name: string };
      return assignTag(pullId, name);
    });
  };
}
