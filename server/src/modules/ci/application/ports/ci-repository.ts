import type { CiFailOn, Provider } from '@devdigest/shared';

/**
 * Persistence port for the `ci` module (onion: the application owns this
 * interface; the Drizzle adapter implements it). Use-cases never import
 * `drizzle-orm`/`src/db/*`; they depend only on these row/DTO shapes, all
 * workspace-scoped where the operation is workspace-facing.
 */

/** Agent config + resolved skills needed to serialize a manifest for export. */
export interface ExportableAgent {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  strategy: 'auto' | 'single-pass' | 'map-reduce';
  ciFailOn: CiFailOn;
  /** Linked skills in order (name drives the slug, body is the file contents). */
  skills: { name: string; body: string }[];
}

/** A persisted installation row (snake_case already — repo returns rows). */
export interface CiInstallationRow {
  id: string;
  agentId: string;
  repo: string;
  targetType: 'gha' | 'circle' | 'jenkins' | 'cli';
  tokenHash: string | null;
  installedAt: Date | null;
}

export interface UpsertInstallationInput {
  agentId: string;
  repo: string;
  targetType: 'gha' | 'circle' | 'jenkins' | 'cli';
  /** Only set on first create — a re-export keeps the existing token (AC-7). */
  tokenHash: string;
}

export interface InsertCiRunInput {
  ciInstallationId: string;
  prNumber: number | null;
  ranAt: Date;
  verdict: string;
  findingsCount: number;
  critical: number | null;
  warning: number | null;
  suggestion: number | null;
  costUsd: number | null;
  durationMs: number | null;
  commitSha: string | null;
  runId: string | null;
  runAttempt: number | null;
  githubUrl: string | null;
  source: string;
}

/** A CI-tab installation row joined with its latest run outcome (AC-1). */
export interface InstallationWithLatest {
  id: string;
  repo: string;
  targetType: string;
  installedAt: Date | null;
  latestVerdict: string | null;
  latestRanAt: Date | null;
}

/** A CI-Runs list row joined across ci_runs ↔ installations ↔ agents (AC-19). */
export interface CiRunListRow {
  id: string;
  ciInstallationId: string | null;
  repo: string | null;
  prNumber: number | null;
  ranAt: Date | null;
  verdict: string | null;
  findingsCount: number | null;
  critical: number | null;
  warning: number | null;
  suggestion: number | null;
  costUsd: number | null;
  durationMs: number | null;
  commitSha: string | null;
  runId: string | null;
  runAttempt: number | null;
  githubUrl: string | null;
  agentName: string | null;
}

export interface CiRepositoryPort {
  /** Agent + resolved skills, scoped to workspace. `null` if not in workspace. */
  getExportableAgent(workspaceId: string, agentId: string): Promise<ExportableAgent | null>;

  /**
   * Create the `(agent, repo)` installation if absent (storing `tokenHash`), or
   * return the existing one (keeping its token). Atomic. Returns the row + a
   * flag marking whether it was created in this call (so the caller knows
   * whether a NEW plaintext token exists to show the member — AC-7).
   */
  upsertInstallation(
    input: UpsertInstallationInput,
  ): Promise<{ row: CiInstallationRow; created: boolean }>;

  /** Installations for an agent (workspace-scoped) + latest run outcome (AC-1). */
  listInstallations(workspaceId: string, agentId: string): Promise<InstallationWithLatest[]>;

  /** Find an installation by the ingest token's hash (ingest auth, AC-15). */
  findInstallationByTokenHash(tokenHash: string): Promise<CiInstallationRow | null>;

  /**
   * Insert one `ci_runs` row, idempotent on (installation, run_id, run_attempt)
   * via the unique dedupe index (AC-18). Returns `false` when the row already
   * existed (ON CONFLICT DO NOTHING) so the caller can still answer success.
   */
  insertCiRun(input: InsertCiRunInput): Promise<{ inserted: boolean }>;

  /** 50 most recent workspace CI runs, ran_at desc, id desc (AC-19). */
  listCiRuns(workspaceId: string, limit: number): Promise<CiRunListRow[]>;
}
