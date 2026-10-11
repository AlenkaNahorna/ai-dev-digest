import type { AttachedDoc, LinkedSkillDocs, UsageRow } from '../../domain/effective-set.js';

/** The slice of a repo row the module needs. `workspaceId` is used for tenancy checks only. */
export interface RepoInfo {
  id: string;
  workspaceId: string;
  owner: string;
  name: string;
}

export interface ScannedDoc {
  /** Repo-relative, `/`-separated. */
  path: string;
  size: number;
  /** ISO timestamp of the file's last modification. */
  updatedAt: string;
}

/** Lists Markdown documents under `roots` in the synced clone (never follows symlinks). */
export interface DocScanner {
  scan(repo: RepoInfo, roots: readonly string[]): Promise<ScannedDoc[]>;
}

/** Reads one document's text from the clone (path containment enforced by the adapter). Throws when unreadable. */
export interface DocReader {
  read(repo: RepoInfo, path: string): Promise<string>;
}

export interface TokenCounter {
  count(text: string): number;
}

export interface ReposPort {
  /** Looks the repo up regardless of workspace so a foreign id can be told apart (403). */
  findById(repoId: string): Promise<RepoInfo | undefined>;
}

export type OwnerKind = 'agent' | 'skill';

export interface EffectiveInputs {
  agentDocs: AttachedDoc[];
  /** Enabled links to enabled skills only. */
  skills: LinkedSkillDocs[];
}

export interface AttachmentsRepo {
  /** Whether the agent/skill belongs to the workspace. */
  ownerInWorkspace(kind: OwnerKind, workspaceId: string, ownerId: string): Promise<boolean>;
  getDocs(kind: OwnerKind, ownerId: string, repoId: string): Promise<AttachedDoc[]>;
  /** Atomic replace of the owner's set for one repo: a failure leaves the previous set intact. */
  replaceDocs(kind: OwnerKind, ownerId: string, repoId: string, docs: AttachedDoc[]): Promise<void>;
  /** Raw inputs of the effective set for one agent+repo, workspace-scoped. */
  effectiveInputs(workspaceId: string, agentId: string, repoId: string): Promise<EffectiveInputs>;
}

export interface UsageRepo {
  /** Which agents of the workspace receive which docs of the repo. */
  listUsage(workspaceId: string, repoId: string): Promise<{ direct: UsageRow[]; viaSkills: UsageRow[] }>;
}

export interface ProjectContextSettings {
  roots: readonly string[];
  warnTokens: number;
}
