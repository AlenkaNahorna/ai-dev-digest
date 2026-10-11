import { unusableReason } from '../../domain/doc-text.js';
import { effectiveSet } from '../../domain/effective-set.js';
import { isDiscoverablePath } from '../../domain/root-match.js';
import type {
  AttachmentsRepo,
  DocReader,
  ProjectContextSettings,
  RepoInfo,
  TokenCounter,
} from '../ports/project-context-ports.js';

export type SkipReason = 'outside_roots' | 'unreadable' | 'empty' | 'non_utf8';

export interface ResolvedDoc {
  path: string;
  text: string;
  /** Tokens of the document text (same counting method as the listing). */
  tokens: number;
}

export interface ResolvedRunContext {
  /** Injectable documents, in prompt order. */
  docs: ResolvedDoc[];
  /** Attached documents that could not be used; carry the path only, never text. */
  skipped: { path: string; reason: SkipReason }[];
}

export interface ResolveForRunDeps {
  attachments: AttachmentsRepo;
  reader: DocReader;
  tokenizer: TokenCounter;
  settings: ProjectContextSettings;
}

/**
 * Read an agent's effective documents ONCE at run start (a single snapshot —
 * later edits never alter a running or finished run). Unusable documents are
 * skipped and reported by path; the run continues. No LLM call, no logging of
 * document text.
 */
export function createResolveForRun({ attachments, reader, tokenizer, settings }: ResolveForRunDeps) {
  return async (workspaceId: string, agentId: string, repo: RepoInfo): Promise<ResolvedRunContext> => {
    const inputs = await attachments.effectiveInputs(workspaceId, agentId, repo.id);
    const paths = effectiveSet(inputs.agentDocs, inputs.skills);
    const docs: ResolvedDoc[] = [];
    const skipped: ResolvedRunContext['skipped'] = [];
    for (const path of paths) {
      if (!isDiscoverablePath(path, settings.roots)) {
        skipped.push({ path, reason: 'outside_roots' });
        continue;
      }
      let text: string;
      try {
        text = await reader.read(repo, path);
      } catch {
        skipped.push({ path, reason: 'unreadable' });
        continue;
      }
      const bad = unusableReason(text);
      if (bad) {
        skipped.push({ path, reason: bad });
        continue;
      }
      docs.push({ path, text, tokens: tokenizer.count(text) });
    }
    return { docs, skipped };
  };
}
