import type { RepoRef } from './input.js';
import { normalizeKey } from './input.js';

/** Result of looking one thing up in a list; ambiguity is reported, never guessed. */
export type Match<T> =
  | { readonly kind: 'none' }
  | { readonly kind: 'one'; readonly item: T }
  | { readonly kind: 'many'; readonly items: readonly T[] };

function toMatch<T>(items: readonly T[]): Match<T> {
  const [first] = items;
  if (first === undefined) return { kind: 'none' };
  if (items.length === 1) return { kind: 'one', item: first };
  return { kind: 'many', items };
}

/** Repo whose `full_name` equals `owner/name`, case-insensitively. */
export function matchRepo<T extends { readonly full_name: string }>(
  repos: readonly T[],
  ref: RepoRef,
): Match<T> {
  const wanted = normalizeKey(`${ref.owner}/${ref.name}`);
  return toMatch(repos.filter((r) => normalizeKey(r.full_name) === wanted));
}

/** Pull request with this number. */
export function matchPull<T extends { readonly number: number }>(
  pulls: readonly T[],
  number: number,
): Match<T> {
  return toMatch(pulls.filter((p) => p.number === number));
}

/** Agent whose `name` equals `name`, case-insensitively (names are not unique). */
export function matchAgent<T extends { readonly name: string }>(
  agents: readonly T[],
  name: string,
): Match<T> {
  const wanted = normalizeKey(name);
  return toMatch(agents.filter((a) => normalizeKey(a.name) === wanted));
}
