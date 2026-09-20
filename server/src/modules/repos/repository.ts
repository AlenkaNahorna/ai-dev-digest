import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { CLONE_JOB_KIND } from './constants.js';

/**
 * F1 — repos data-access layer. The ONLY place that touches the `repos`
 * table. Every query is scoped by `workspaceId` (tenancy guard).
 */

export type RepoRow = typeof t.repos.$inferSelect;

export interface InsertRepo {
  workspaceId: string;
  owner: string;
  name: string;
  fullName: string;
  createdBy: string;
}

export class RepoRepository {
  constructor(private db: Db) {}

  /** Find a repo in a workspace by its `owner/name` full name (dedupe on add). */
  async findByFullName(workspaceId: string, fullName: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, fullName)));
    return row;
  }

  async list(workspaceId: string): Promise<RepoRow[]> {
    return this.db.select().from(t.repos).where(eq(t.repos.workspaceId, workspaceId));
  }

  /**
   * Latest failed `clone` job's error per repo (repoId -> message), for repos
   * that never got a `clone_path` — surfaced on the repo so the UI can show
   * why a repo never imported instead of leaving it silently stuck.
   */
  async latestCloneErrors(workspaceId: string): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ payload: t.jobs.payload, error: t.jobs.error })
      .from(t.jobs)
      .where(
        and(
          eq(t.jobs.workspaceId, workspaceId),
          eq(t.jobs.kind, CLONE_JOB_KIND),
          eq(t.jobs.status, 'failed'),
        ),
      )
      .orderBy(desc(t.jobs.finishedAt));
    const map = new Map<string, string>();
    for (const row of rows) {
      const repoId = (row.payload as { repoId?: string } | null)?.repoId;
      // Rows are newest-first → first seen per repo is the latest failure.
      if (repoId && row.error && !map.has(repoId)) map.set(repoId, row.error);
    }
    return map;
  }

  async getById(workspaceId: string, id: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, id)));
    return row;
  }

  async insert(values: InsertRepo): Promise<RepoRow> {
    const [row] = await this.db
      .insert(t.repos)
      .values({
        workspaceId: values.workspaceId,
        owner: values.owner,
        name: values.name,
        fullName: values.fullName,
        createdBy: values.createdBy,
      })
      .returning();
    return row!;
  }

  /**
   * Look up the workspace owning a repo (by repo id, no tenancy scope —
   * the JobRunner's `runCloneJob` is the only caller and it already trusted
   * the payload that came out of an authenticated `add()`). Returns null
   * if the repo was deleted before the followup ran.
   */
  async workspaceIdFor(repoId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ workspaceId: t.repos.workspaceId })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row?.workspaceId ?? null;
  }

  /** Persist the clone path and bump `last_polled_at` once a clone job completes. */
  async updateClonePath(repoId: string, clonePath: string): Promise<void> {
    await this.db
      .update(t.repos)
      .set({ clonePath, lastPolledAt: new Date() })
      .where(eq(t.repos.id, repoId));
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, id)))
      .returning({ id: t.repos.id });
    return deleted.length > 0;
  }
}
