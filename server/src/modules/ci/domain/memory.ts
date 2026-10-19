/**
 * Serialize workspace memory to `.devdigest/memory.jsonl` (one JSON object per
 * line). Pure (domain layer). Only curated, human-readable fields are exported —
 * never embeddings, ids of other tenants or source metadata — and the member sees
 * the exact contents in the wizard's Preview step before anything is committed.
 */

export interface MemoryExportEntry {
  scope: 'repo' | 'global' | 'team';
  kind: 'decision' | 'convention' | 'preference' | 'fact' | 'learning';
  content: string;
  confidence: number | null;
}

/**
 * One line per entry, trailing newline. An empty memory yields a single newline
 * (not an empty string): the GitHub tree API is unreliable with empty blob
 * content, and the runner skips blank lines.
 */
export function memoryToJsonl(entries: readonly MemoryExportEntry[]): string {
  if (entries.length === 0) return '\n';
  return (
    entries
      .map((e) =>
        JSON.stringify({ scope: e.scope, kind: e.kind, content: e.content, confidence: e.confidence }),
      )
      .join('\n') + '\n'
  );
}
