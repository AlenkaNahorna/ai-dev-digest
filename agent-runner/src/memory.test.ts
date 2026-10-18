import { describe, it, expect } from 'vitest';
import { loadMemory, MEMORY_MAX_CONTENT_CHARS, MEMORY_MAX_ENTRIES } from './memory.js';

const reader = (content: string | Error) =>
  ((() => {
    if (content instanceof Error) throw content;
    return content;
  }) as unknown) as typeof import('node:fs').readFileSync;

describe('loadMemory', () => {
  it('returns [] when memory.jsonl is missing', () => {
    expect(loadMemory('/x/.devdigest', reader(new Error('ENOENT')))).toEqual([]);
  });

  it('maps entries to "[kind] content" strings and skips blank/malformed lines', () => {
    const file = [
      JSON.stringify({ scope: 'repo', kind: 'convention', content: 'Use zod at every boundary', confidence: 0.9 }),
      '',
      'not json',
      JSON.stringify({ kind: 'fact' }),
      JSON.stringify({ content: 'no kind' }),
    ].join('\n');
    expect(loadMemory('/x/.devdigest', reader(file))).toEqual([
      '[convention] Use zod at every boundary',
      'no kind',
    ]);
  });

  it('treats the lone newline the exporter writes for empty memory as no entries', () => {
    expect(loadMemory('/x/.devdigest', reader('\n'))).toEqual([]);
  });

  it('caps entry count and content length', () => {
    const many = Array.from({ length: MEMORY_MAX_ENTRIES + 5 }, (_, i) =>
      JSON.stringify({ kind: 'fact', content: `entry ${i}` }),
    ).join('\n');
    expect(loadMemory('/x/.devdigest', reader(many))).toHaveLength(MEMORY_MAX_ENTRIES);

    const long = JSON.stringify({ kind: 'fact', content: 'x'.repeat(MEMORY_MAX_CONTENT_CHARS + 50) });
    expect(loadMemory('/x/.devdigest', reader(long))[0]).toHaveLength('[fact] '.length + MEMORY_MAX_CONTENT_CHARS);
  });
});
