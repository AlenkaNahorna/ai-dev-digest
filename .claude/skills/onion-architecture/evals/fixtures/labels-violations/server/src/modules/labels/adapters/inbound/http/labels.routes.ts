import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../../../../db/client.js';
import { labels } from '../../../../../db/schema.js';
import { createCreateLabel } from '../../../application/use-cases/create-label.js';
import type { LabelRepositoryPort } from '../../../application/ports/label-ports.js';

export const labelsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/repos/:repoId/labels', async (request) => {
    const { repoId } = request.params as { repoId: string };
    return db.select().from(labels).where(eq(labels.repoId, repoId));
  });

  app.post('/repos/:repoId/labels', async (request) => {
    const { repoId } = request.params as { repoId: string };
    const body = request.body as { name: string; color: string; repository: LabelRepositoryPort };
    const createLabel = createCreateLabel({ repository: body.repository });
    return createLabel(repoId, body.name, body.color, request);
  });
};
