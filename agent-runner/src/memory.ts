import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Loads the curated memory the studio exported to `.devdigest/memory.jsonl`
 * (one JSON object per line: `{ scope, kind, content, confidence }`) and turns it
 * into the plain strings `reviewPullRequest({ memory })` takes — the same
 * resolved-string contract the studio uses for local reviews.
 *
 * The file is OPTIONAL and best-effort: memory only sharpens a review, so a
 * missing file, a blank line or one malformed line never fails the run (unlike a
 * broken manifest, which does). Entries and sizes are capped so a hand-edited
 * file cannot blow up the prompt.
 */

export const MEMORY_MAX_ENTRIES = 200;
export const MEMORY_MAX_CONTENT_CHARS = 2000;

export function loadMemory(
  devdigestDir: string,
  readFile: typeof readFileSync = readFileSync,
): string[] {
  let raw: string;
  try {
    raw = readFile(path.join(devdigestDir, 'memory.jsonl'), 'utf8') as unknown as string;
  } catch {
    return [];
  }

  const out: string[] = [];
  for (const line of raw.split('\n')) {
    if (out.length >= MEMORY_MAX_ENTRIES) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const { kind, content } = parsed as { kind?: unknown; content?: unknown };
    if (typeof content !== 'string' || content.trim() === '') continue;
    const text = content.trim().slice(0, MEMORY_MAX_CONTENT_CHARS);
    out.push(typeof kind === 'string' && kind ? `[${kind}] ${text}` : text);
  }
  return out;
}
