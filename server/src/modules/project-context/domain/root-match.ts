/**
 * Root matching for Project Context discovery. Roots are plain FOLDER NAMES
 * (e.g. `specs`, `docs`, `insights`), matched against the directory segments of
 * a repo-relative path at any depth — a deliberate, glob-free simplification of
 * `**\/{specs,docs,insights}/**\/*.md` (no glob dependency, no lockfile change).
 */

/** Special `PROJECT_CONTEXT_ROOTS` value: discover every `.md` in the clone. */
export const ALL_ROOTS = '*';
/** Document type of a `.md` at the repository root when roots is `*`. */
export const ROOT_LEVEL_TYPE = 'root';

/** Directories never descended into: third-party, vendored or generated trees. */
export const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.pnpm-store',
  'dist',
  'vendor',
  'build',
  'coverage',
  '.next',
  'out',
]);

export function isExcludedDir(name: string): boolean {
  return EXCLUDED_DIRS.has(name);
}

export function isMarkdownPath(path: string): boolean {
  return /\.md$/i.test(path);
}

/** Directory segments of a `/`-separated repo-relative path (the file name is dropped). */
export function dirSegments(path: string): string[] {
  const parts = path.split('/');
  parts.pop();
  return parts;
}

/**
 * The root folder a path belongs to: the OUTERMOST directory segment that is
 * one of `roots`. `undefined` when no segment matches, or when any directory
 * segment is an excluded one (so `node_modules/x/docs/a.md` never matches).
 */
export function findRoot(path: string, roots: readonly string[]): string | undefined {
  const dirs = dirSegments(path);
  if (dirs.some(isExcludedDir)) return undefined;
  // `*` = every folder is a root: the type is the top-level folder, or `root` for
  // files at the repository root.
  if (roots.includes(ALL_ROOTS)) return dirs[0] ?? ROOT_LEVEL_TYPE;
  return dirs.find((d) => roots.includes(d));
}

/** A discoverable document: a `.md` file under (any depth of) a configured root. */
export function isDiscoverablePath(path: string, roots: readonly string[]): boolean {
  return isMarkdownPath(path) && findRoot(path, roots) !== undefined;
}
