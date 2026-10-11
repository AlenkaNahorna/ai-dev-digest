import type { ProjectContextList, SpecFile } from '@devdigest/shared';
import { docTypeOf } from '../../domain/doc-type.js';
import { mapLimit } from '../map-limit.js';
import type {
  DocReader,
  DocScanner,
  ProjectContextSettings,
  ReposPort,
  TokenCounter,
} from '../ports/project-context-ports.js';
import type { CountUsage } from './count-usage.js';
import { requireRepo } from './repo-access.js';

/** Parallel document reads while tokenizing a listing. */
const READ_CONCURRENCY = 16;

export interface ListContextDeps {
  repos: ReposPort;
  scanner: DocScanner;
  reader: DocReader;
  countUsage: CountUsage;
  tokenizer: TokenCounter;
  settings: ProjectContextSettings;
  now?: () => Date;
}

/**
 * Discover the repo's Markdown documents and size them (pure read, no LLM).
 * A root missing from the clone simply contributes nothing; an unreadable
 * document is listed with `tokens: null` rather than failing the request.
 */
export function createListContext({ repos, scanner, reader, countUsage, tokenizer, settings, now = () => new Date() }: ListContextDeps) {
  return async (workspaceId: string, repoId: string): Promise<ProjectContextList> => {
    const repo = await requireRepo(repos, workspaceId, repoId);
    const [scanned, usedBy] = await Promise.all([
      scanner.scan(repo, settings.roots),
      countUsage(workspaceId, repoId),
    ]);

    const files: SpecFile[] = await mapLimit(scanned, READ_CONCURRENCY, async (doc) => {
      let tokens: number | null = null;
      try {
        tokens = tokenizer.count(await reader.read(repo, doc.path));
      } catch {
        tokens = null;
      }
      return {
        path: doc.path,
        type: docTypeOf(doc.path, settings.roots),
        size: doc.size,
        updated_at: doc.updatedAt,
        tokens,
        used_by_agents: usedBy.get(doc.path) ?? 0,
      };
    });
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    return {
      roots: [...settings.roots],
      warn_tokens: settings.warnTokens,
      tokens_total: files.reduce((n, f) => n + (f.tokens ?? 0), 0),
      files,
      index: { files: files.length, indexed_at: now().toISOString() },
    };
  };
}
