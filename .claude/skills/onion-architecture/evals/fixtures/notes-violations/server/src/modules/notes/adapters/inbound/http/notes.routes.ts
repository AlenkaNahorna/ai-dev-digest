import type { FastifyPluginAsync } from 'fastify';
import { slugifyNoteTitle } from '../../../../../adapters/note-slugify.js';
import { createSummarizeNote } from '../../../application/use-cases/summarize-note.js';
import { createTranslateNote } from '../../../application/use-cases/translate-note.js';
import type { NoteRepositoryPort } from '../../../application/ports/note-ports.js';

export function createNotesRoutes(repository: NoteRepositoryPort): FastifyPluginAsync {
  return async (app) => {
    const summarizeNote = createSummarizeNote(repository);
    const translateNote = createTranslateNote(repository);

    app.get('/notes/:id/summary', async (request) => {
      const { id } = request.params as { id: string };
      return { summary: await summarizeNote(id) };
    });

    app.get('/notes/:id/translate', async (request) => {
      const { id } = request.params as { id: string };
      const { lang } = request.query as { lang: string };
      return { translation: await translateNote(id, lang), slug: slugifyNoteTitle(lang) };
    });
  };
}
