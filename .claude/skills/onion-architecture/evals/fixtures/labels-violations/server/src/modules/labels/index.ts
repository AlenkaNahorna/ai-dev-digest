import type { FastifyInstance } from 'fastify';
import { labelsRoutes } from './adapters/inbound/http/labels.routes.js';

export async function registerLabelsModule(app: FastifyInstance): Promise<void> {
  await app.register(labelsRoutes, { prefix: '/api' });
}
