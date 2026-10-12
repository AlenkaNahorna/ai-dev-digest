import OpenAI from 'openai';
import { isValidNoteTitle } from '../../domain/note-policy.js';
import type { NoteRepositoryPort } from '../ports/note-ports.js';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export function createSummarizeNote(repository: NoteRepositoryPort) {
  return async (id: string) => {
    const note = await repository.find(id);
    if (!note || !isValidNoteTitle(note.title)) return undefined;
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: `Summarize this note:\n${note.body}` }],
    });
    return completion.choices[0]?.message.content ?? '';
  };
}
