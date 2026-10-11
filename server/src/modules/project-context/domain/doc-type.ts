import { findRoot } from './root-match.js';

/** Document type = the matching root folder (`specs`, `docs`, `insights`, …), or null. */
export function docTypeOf(path: string, roots: readonly string[]): string | null {
  return findRoot(path, roots) ?? null;
}
