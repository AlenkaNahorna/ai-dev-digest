import type {
  ContextAttachments,
  ContextAttachmentsInput,
  ContextDocBody,
  ProjectContextList,
} from '@devdigest/shared';
import type { OwnerKind, RepoInfo } from './ports/project-context-ports.js';
import type { ResolvedRunContext } from './use-cases/resolve-for-run.js';

/**
 * The module's surface for the rest of the app. Consumers (HTTP routes, the
 * review run-executor) reach it through `container.projectContext`, never by
 * importing the module's internals.
 */
export interface ProjectContextFacade {
  list(workspaceId: string, repoId: string): Promise<ProjectContextList>;
  getDoc(workspaceId: string, repoId: string, path: string): Promise<ContextDocBody>;
  getAttachments(kind: OwnerKind, workspaceId: string, ownerId: string, repoId: string): Promise<ContextAttachments>;
  putAttachments(kind: OwnerKind, workspaceId: string, ownerId: string, input: ContextAttachmentsInput): Promise<ContextAttachments>;
  /** Effective documents of one agent for a run on `repo`, read once. */
  resolveForRun(workspaceId: string, agentId: string, repo: RepoInfo): Promise<ResolvedRunContext>;
}
