import type { ProjectContextList, SpecFile } from "@devdigest/shared";

/** One attached document as the UI edits it (the server stores path + order only). */
export interface AttachedItem {
  path: string;
  order: number;
  missing?: boolean | null;
}

/** A row of the attach list: a discovered document, or an attached path that is no longer discovered. */
export interface ContextRow {
  path: string;
  type: string | null;
  tokens: number | null;
  attached: boolean;
  /** Position in the attached order (0-based), when attached. */
  position: number | null;
  /** Attached but no longer discovered in the repo. */
  missing: boolean;
}

/** Re-number a list 0..n-1 in its current sequence (orders must be unique on save). */
export function normalizeOrder<T extends { path: string }>(items: readonly T[]): { path: string; order: number }[] {
  return items.map((it, i) => ({ path: it.path, order: i }));
}

export function sortByOrder<T extends { order: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order);
}

/** Toggle one path: detach if attached, else append at the end. */
export function toggleAttachment(current: readonly AttachedItem[], path: string): { path: string; order: number }[] {
  const ordered = sortByOrder(current);
  return normalizeOrder(
    ordered.some((d) => d.path === path) ? ordered.filter((d) => d.path !== path) : [...ordered, { path }],
  );
}

/** Move an attached path one step up (-1) or down (+1); no-op at the ends or when not attached. */
export function moveAttachment(current: readonly AttachedItem[], path: string, delta: -1 | 1): { path: string; order: number }[] {
  const ordered = sortByOrder(current);
  const from = ordered.findIndex((d) => d.path === path);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ordered.length) return normalizeOrder(ordered);
  const next = [...ordered];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return normalizeOrder(next);
}

/** Drag-and-drop: put `dragged` where `target` currently sits. */
export function reorderAttachment(current: readonly AttachedItem[], dragged: string, target: string): { path: string; order: number }[] {
  const ordered = sortByOrder(current);
  const from = ordered.findIndex((d) => d.path === dragged);
  const to = ordered.findIndex((d) => d.path === target);
  if (from < 0 || to < 0 || from === to) return normalizeOrder(ordered);
  const next = [...ordered];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return normalizeOrder(next);
}

/**
 * Rows of the attach list: attached documents first (in order, missing ones
 * included and flagged), then the remaining discovered documents. The filter
 * only hides rows (case-insensitive path match); it never changes attachments.
 */
export function buildRows(files: readonly SpecFile[], attached: readonly AttachedItem[], filter: string): ContextRow[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const ordered = sortByOrder(attached);
  const attachedPaths = new Set(ordered.map((d) => d.path));
  const rows: ContextRow[] = [
    ...ordered.map((d, i): ContextRow => {
      const f = byPath.get(d.path);
      return { path: d.path, type: f?.type ?? null, tokens: f?.tokens ?? null, attached: true, position: i, missing: !f };
    }),
    ...files
      .filter((f) => !attachedPaths.has(f.path))
      .map((f): ContextRow => ({ path: f.path, type: f.type ?? null, tokens: f.tokens ?? null, attached: false, position: null, missing: false })),
  ];
  const q = filter.trim().toLowerCase();
  return q ? rows.filter((r) => r.path.toLowerCase().includes(q)) : rows;
}

/** Approximate tokens of the attached set (missing documents contribute nothing; they are skipped at run). */
export function attachedTokens(files: readonly SpecFile[], attached: readonly AttachedItem[]): number {
  const byPath = new Map(files.map((f) => [f.path, f]));
  return attached.reduce((n, d) => n + (byPath.get(d.path)?.tokens ?? 0), 0);
}

export function overWarning(total: number, list: Pick<ProjectContextList, "warn_tokens"> | undefined): boolean {
  return !!list && total > list.warn_tokens;
}

export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}
