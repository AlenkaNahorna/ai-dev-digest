import type { ContextAttachments, ContextAttachmentsInput } from '@devdigest/shared';
import { ProjectContextError } from '../errors.js';
import type {
  AttachmentsRepo,
  DocScanner,
  OwnerKind,
  ProjectContextSettings,
  ReposPort,
} from '../ports/project-context-ports.js';
import { requireRepo } from './repo-access.js';

export interface AttachmentsDeps {
  repos: ReposPort;
  scanner: DocScanner;
  attachments: AttachmentsRepo;
  settings: ProjectContextSettings;
}

async function requireOwner(attachments: AttachmentsRepo, kind: OwnerKind, workspaceId: string, ownerId: string) {
  if (!(await attachments.ownerInWorkspace(kind, workspaceId, ownerId))) {
    throw new ProjectContextError('not_found', kind === 'agent' ? 'Agent not found' : 'Skill not found');
  }
}

/**
 * Stored set of one agent/skill for one repo, ordered. Paths that are no
 * longer discovered stay listed, flagged `missing`, so the user can remove them.
 */
export function createGetAttachments({ repos, scanner, attachments, settings }: AttachmentsDeps) {
  return async (kind: OwnerKind, workspaceId: string, ownerId: string, repoId: string): Promise<ContextAttachments> => {
    const repo = await requireRepo(repos, workspaceId, repoId);
    await requireOwner(attachments, kind, workspaceId, ownerId);
    const [stored, scanned] = await Promise.all([
      attachments.getDocs(kind, ownerId, repoId),
      scanner.scan(repo, settings.roots),
    ]);
    const present = new Set(scanned.map((d) => d.path));
    return {
      repo_id: repoId,
      docs: [...stored]
        .sort((a, b) => a.order - b.order)
        .map((d) => ({ path: d.path, order: d.order, missing: !present.has(d.path) })),
    };
  };
}

/**
 * Replace the whole set atomically (AC-47). Shape rules (traversal, `.md`,
 * duplicate paths/orders) are enforced by the transport schema; here every
 * path must be a currently discovered document. A path that is ALREADY
 * attached may stay even if it is no longer discovered, so the user can edit
 * the rest of the set without being forced to drop a "missing" row first.
 */
export function createPutAttachments(deps: AttachmentsDeps) {
  const get = createGetAttachments(deps);
  const { repos, scanner, attachments, settings } = deps;
  return async (kind: OwnerKind, workspaceId: string, ownerId: string, input: ContextAttachmentsInput): Promise<ContextAttachments> => {
    const repo = await requireRepo(repos, workspaceId, input.repo_id);
    await requireOwner(attachments, kind, workspaceId, ownerId);
    const [stored, scanned] = await Promise.all([
      attachments.getDocs(kind, ownerId, input.repo_id),
      scanner.scan(repo, settings.roots),
    ]);
    const allowed = new Set([...scanned.map((d) => d.path), ...stored.map((d) => d.path)]);
    const rejected = input.docs.filter((d) => !allowed.has(d.path)).map((d) => d.path);
    if (rejected.length > 0) {
      throw new ProjectContextError('invalid', 'Some paths are not discovered project-context documents', { paths: rejected });
    }
    await attachments.replaceDocs(kind, ownerId, input.repo_id, input.docs.map((d) => ({ path: d.path, order: d.order })));
    return get(kind, workspaceId, ownerId, input.repo_id);
  };
}
