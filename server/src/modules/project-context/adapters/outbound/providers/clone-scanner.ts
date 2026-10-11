import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitClient } from '@devdigest/shared';
import type {
  DocReader,
  DocScanner,
  RepoInfo,
  ScannedDoc,
} from '../../../application/ports/project-context-ports.js';
import { findRoot, isExcludedDir, isMarkdownPath } from '../../../domain/root-match.js';

/** Hard stop against pathological trees; far above the ~200-document design target. */
const MAX_DIRECTORIES = 20_000;

/**
 * Discovers and reads Markdown documents in a repo's synced clone.
 *
 *  - Walks the clone but never descends into EXCLUDED dirs (node_modules, .git, …).
 *  - Symlinks (files and directories) are skipped entirely, so nothing that
 *    resolves outside the clone can be listed (AC-4).
 *  - A missing clone or root is tolerated (empty result, AC-7).
 *  - Reads go through `GitClient.readFile`, which re-checks path containment
 *    (including realpath) — the walk is not trusted as the only guard.
 *
 * `git` is a thunk so a container-level override of `container.git` applies.
 */
export class CloneDocScanner implements DocScanner, DocReader {
  constructor(private readonly git: () => GitClient) {}

  async scan(repo: RepoInfo, roots: readonly string[]): Promise<ScannedDoc[]> {
    const base = this.git().clonePathFor({ owner: repo.owner, name: repo.name });
    const out: ScannedDoc[] = [];
    let visited = 0;

    const walk = async (relDir: string): Promise<void> => {
      if (++visited > MAX_DIRECTORIES) return;
      let entries;
      try {
        entries = await readdir(relDir === '' ? base : join(base, relDir), { withFileTypes: true });
      } catch {
        return; // missing/unreadable directory — tolerated
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (!isExcludedDir(entry.name)) await walk(rel);
        } else if (entry.isFile() && isMarkdownPath(entry.name) && findRoot(rel, roots) !== undefined) {
          try {
            const st = await stat(join(base, rel));
            out.push({ path: rel, size: st.size, updatedAt: st.mtime.toISOString() });
          } catch {
            /* vanished between readdir and stat — skip */
          }
        }
      }
    };

    await walk('');
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  read(repo: RepoInfo, path: string): Promise<string> {
    return this.git().readFile({ owner: repo.owner, name: repo.name }, path);
  }
}
