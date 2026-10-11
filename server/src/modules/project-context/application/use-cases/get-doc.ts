import type { ContextDocBody } from '@devdigest/shared';
import { docTypeOf } from '../../domain/doc-type.js';
import { isDiscoverablePath } from '../../domain/root-match.js';
import { ProjectContextError } from '../errors.js';
import type {
  DocReader,
  DocScanner,
  ProjectContextSettings,
  ReposPort,
  TokenCounter,
} from '../ports/project-context-ports.js';
import type { CountUsage } from './count-usage.js';
import { requireRepo } from './repo-access.js';

export interface GetDocDeps {
  repos: ReposPort;
  scanner: DocScanner;
  reader: DocReader;
  countUsage: CountUsage;
  tokenizer: TokenCounter;
  settings: ProjectContextSettings;
}

/** One document's full text for the read-only Preview. Only discovered documents are served. */
export function createGetDoc({ repos, scanner, reader, countUsage, tokenizer, settings }: GetDocDeps) {
  return async (workspaceId: string, repoId: string, path: string): Promise<ContextDocBody> => {
    const repo = await requireRepo(repos, workspaceId, repoId);
    if (!isDiscoverablePath(path, settings.roots)) {
      throw new ProjectContextError('invalid', 'Path is not a project-context document');
    }
    const scanned = (await scanner.scan(repo, settings.roots)).find((d) => d.path === path);
    if (!scanned) throw new ProjectContextError('not_found', 'Document not found');
    let content: string;
    try {
      content = await reader.read(repo, path);
    } catch {
      throw new ProjectContextError('not_found', 'Document could not be read');
    }
    const usedBy = await countUsage(workspaceId, repoId);
    return {
      path,
      type: docTypeOf(path, settings.roots),
      content,
      size: scanned.size,
      tokens: tokenizer.count(content),
      updated_at: scanned.updatedAt,
      used_by_agents: usedBy.get(path) ?? 0,
    };
  };
}
