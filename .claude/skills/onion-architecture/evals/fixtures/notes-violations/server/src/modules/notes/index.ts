import type { FastifyInstance } from 'fastify';
import { createNotesRoutes } from './adapters/inbound/http/notes.routes.js';
import type { NoteRepositoryPort } from './application/ports/note-ports.js';

export async function registerNotesModule(
  app: FastifyInstance,
  repository: NoteRepositoryPort,
): Promise<void> {
  await app.register(createNotesRoutes(repository), { prefix: '/api' });
}
