import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ConventionCategory } from '@devdigest/shared';
import type { Db } from '../../../../../db/client.js';
import * as t from '../../../../../db/schema.js';

export type ConventionRow = typeof t.conventions.$inferSelect;

export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  runId: string;
  category: ConventionCategory;
  rule: string;
  evidencePath: string;
  evidenceLineStart: number;
  evidenceLineEnd: number;
  evidenceSnippet: string;
  confidence: number;
  accepted: boolean;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  async insertMany(values: InsertConvention[]): Promise<ConventionRow[]> {
    if (values.length === 0) return [];
    return this.db.insert(t.conventions).values(values).returning();
  }

  /**
   * The most recent scan's candidates for a repo, highest-confidence first.
   * `runId: null` + `rows: []` means the repo has never been scanned.
   */
  async latestRun(
    workspaceId: string,
    repoId: string,
  ): Promise<{ runId: string | null; rows: ConventionRow[] }> {
    const [latest] = await this.db
      .select({ runId: t.conventions.runId })
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(desc(t.conventions.createdAt))
      .limit(1);
    if (!latest) return { runId: null, rows: [] };

    const rows = await this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.runId, latest.runId),
        ),
      )
      .orderBy(desc(t.conventions.confidence));
    return { runId: latest.runId, rows };
  }

  async updateAccepted(
    workspaceId: string,
    id: string,
    accepted: boolean,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({ accepted })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  async getByIds(workspaceId: string, repoId: string, ids: string[]): Promise<ConventionRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          inArray(t.conventions.id, ids),
        ),
      );
  }
}
