import OpenAI from 'openai';
import type { NoteRepositoryPort } from '../ports/note-ports.js';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export function createTranslateNote(repository: NoteRepositoryPort) {
  return async (id: string, targetLanguage: string) => {
    const note = await repository.find(id);
    if (!note) return undefined;
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: `Translate this note to ${targetLanguage}:\n${note.body}` }],
    });
    return completion.choices[0]?.message.content ?? '';
  };
}
