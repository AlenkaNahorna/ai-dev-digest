import { and, desc, eq, inArray, isNotNull, max, sql } from 'drizzle-orm';
import type { Db } from '../../../../../db/client.js';
import * as t from '../../../../../db/schema.js';
import type {
  BatchRef,
  BatchRow,
  EvalStorePort,
  NewCase,
  NewSkillCase,
  NewRun,
  StoredCase,
  StoredRun,
} from '../../../application/ports/eval-ports.js';

type CaseRow = typeof t.evalCases.$inferSelect;
type RunRow = typeof t.evalRuns.$inferSelect;

function toCase(row: CaseRow): StoredCase {
  const meta = (row.inputMeta ?? {}) as { pr_id?: string };
  return {
    id: row.id,
    ownerKind: row.ownerKind,
    agentId: row.ownerId,
    name: row.name,
    inputDiff: row.inputDiff ?? '',
    expectation: row.expectedOutput,
    sourceFindingId: row.sourceFindingId,
    sourcePrId: typeof meta.pr_id === 'string' ? meta.pr_id : null,
    createdAt: row.createdAt,
  };
}

function toRun(row: RunRow): StoredRun {
  return {
    id: row.id,
    caseId: row.caseId,
    batchId: row.batchId,
    ranAt: row.ranAt,
    pass: row.pass,
    actualOutput: row.actualOutput,
    durationMs: row.durationMs,
    costUsd: row.costUsd,
    agentVersion: row.agentVersion,
    provider: row.provider,
    model: row.model,
  };
}

/**
 * Persistence for eval cases + runs. `eval_runs` has no workspace column, so
 * every read is scoped through its case (`eval_cases.workspace_id`).
 */
export class EvalRepository implements EvalStorePort {
  constructor(private db: Db) {}

  /** Any owner kind — used by edit / delete / get of a single case. */
  private anyCases(workspaceId: string) {
    return eq(t.evalCases.workspaceId, workspaceId);
  }

  private agentCases(workspaceId: string) {
    return and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'agent'));
  }

  async listCases(workspaceId: string, agentId: string): Promise<StoredCase[]> {
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(and(this.agentCases(workspaceId), eq(t.evalCases.ownerId, agentId)))
      .orderBy(desc(t.evalCases.createdAt), t.evalCases.name);
    return rows.map(toCase);
  }

  async findCaseBySource(workspaceId: string, agentId: string, findingId: string): Promise<StoredCase | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          this.agentCases(workspaceId),
          eq(t.evalCases.ownerId, agentId),
          eq(t.evalCases.sourceFindingId, findingId),
        ),
      );
    return row ? toCase(row) : undefined;
  }

  async insertCase(workspaceId: string, input: NewCase): Promise<StoredCase | 'duplicate'> {
    const rows = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: input.agentId,
        name: input.name,
        inputDiff: input.inputDiff,
        inputMeta: { pr_id: input.sourcePrId, finding_id: input.sourceFindingId },
        expectedOutput: input.expectation,
        sourceFindingId: input.sourceFindingId,
      })
      .onConflictDoNothing()
      .returning();
    return rows[0] ? toCase(rows[0]) : 'duplicate';
  }

  async getCase(workspaceId: string, caseId: string): Promise<StoredCase | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(this.anyCases(workspaceId), eq(t.evalCases.id, caseId)));
    return row ? toCase(row) : undefined;
  }

  async updateCase(
    workspaceId: string,
    caseId: string,
    patch: { name?: string; inputDiff?: string; expectation?: unknown },
  ): Promise<StoredCase | undefined> {
    const set: Partial<typeof t.evalCases.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.inputDiff !== undefined) set.inputDiff = patch.inputDiff;
    if (patch.expectation !== undefined) set.expectedOutput = patch.expectation;
    if (Object.keys(set).length === 0) return this.getCase(workspaceId, caseId);
    const [row] = await this.db
      .update(t.evalCases)
      .set(set)
      .where(and(this.anyCases(workspaceId), eq(t.evalCases.id, caseId)))
      .returning();
    return row ? toCase(row) : undefined;
  }

  async listSkillCases(workspaceId: string, skillId: string): Promise<StoredCase[]> {
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'skill'), eq(t.evalCases.ownerId, skillId)),
      )
      .orderBy(desc(t.evalCases.createdAt), t.evalCases.name);
    return rows.map(toCase);
  }

  async insertManualCase(
    workspaceId: string,
    input: { agentId: string; name: string; inputDiff: string; expectation: unknown },
  ): Promise<StoredCase> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: input.agentId,
        name: input.name,
        inputDiff: input.inputDiff,
        expectedOutput: input.expectation,
      })
      .returning();
    return toCase(row!);
  }

  async insertSkillCase(workspaceId: string, input: NewSkillCase): Promise<StoredCase> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'skill',
        ownerId: input.skillId,
        name: input.name,
        inputDiff: input.inputDiff,
        expectedOutput: input.expectation,
      })
      .returning();
    return toCase(row!);
  }

  async latestSkillRuns(
    workspaceId: string,
    skillId: string,
  ): Promise<Map<string, { withSkill?: StoredRun; withoutSkill?: StoredRun }>> {
    const rows = await this.db
      .select({ run: t.evalRuns })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'skill'), eq(t.evalCases.ownerId, skillId)),
      )
      .orderBy(desc(t.evalRuns.ranAt));
    const out = new Map<string, { withSkill?: StoredRun; withoutSkill?: StoredRun }>();
    for (const { run } of rows) {
      const variant = (run.actualOutput as { variant?: string } | null)?.variant;
      const slot = out.get(run.caseId) ?? {};
      if (variant === 'with_skill' && !slot.withSkill) slot.withSkill = toRun(run);
      if (variant === 'without_skill' && !slot.withoutSkill) slot.withoutSkill = toRun(run);
      out.set(run.caseId, slot);
    }
    return out;
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(this.anyCases(workspaceId), eq(t.evalCases.id, caseId)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  async countCasesByAgent(workspaceId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ agentId: t.evalCases.ownerId, n: sql<number>`count(*)` })
      .from(t.evalCases)
      .where(this.agentCases(workspaceId))
      .groupBy(t.evalCases.ownerId);
    return new Map(rows.map((r) => [r.agentId, Number(r.n)]));
  }

  async insertRuns(runs: NewRun[]): Promise<void> {
    if (runs.length === 0) return;
    await this.db.insert(t.evalRuns).values(
      runs.map((r) => ({
        caseId: r.caseId,
        batchId: r.batchId,
        pass: r.pass,
        actualOutput: r.actualOutput,
        recall: r.recall,
        precision: r.precision,
        citationAccuracy: r.citationAccuracy,
        durationMs: r.durationMs,
        costUsd: r.costUsd,
        agentVersion: r.agentVersion,
        provider: r.provider,
        model: r.model,
      })),
    );
  }

  async latestRunByCase(workspaceId: string, agentId: string): Promise<Map<string, StoredRun>> {
    const rows = await this.db
      .select({ run: t.evalRuns })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(and(this.agentCases(workspaceId), eq(t.evalCases.ownerId, agentId)))
      .orderBy(desc(t.evalRuns.ranAt));
    const latest = new Map<string, StoredRun>();
    for (const { run } of rows) if (!latest.has(run.caseId)) latest.set(run.caseId, toRun(run));
    return latest;
  }

  async listBatchRefs(workspaceId: string, agentId: string | undefined, limit: number): Promise<BatchRef[]> {
    const ranAt = max(t.evalRuns.ranAt);
    const rows = await this.db
      .select({ batchId: t.evalRuns.batchId, agentId: t.evalCases.ownerId, ranAt })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(
          this.agentCases(workspaceId),
          isNotNull(t.evalRuns.batchId),
          agentId ? eq(t.evalCases.ownerId, agentId) : undefined,
        ),
      )
      .groupBy(t.evalRuns.batchId, t.evalCases.ownerId)
      .orderBy(desc(ranAt))
      .limit(limit);
    return rows.flatMap((r) => (r.batchId && r.ranAt ? [{ batchId: r.batchId, agentId: r.agentId, ranAt: r.ranAt }] : []));
  }

  async rowsForBatches(workspaceId: string, batchIds: string[]): Promise<BatchRow[]> {
    if (batchIds.length === 0) return [];
    const rows = await this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name, expectation: t.evalCases.expectedOutput, agentId: t.evalCases.ownerId })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(and(this.agentCases(workspaceId), inArray(t.evalRuns.batchId, batchIds)))
      .orderBy(t.evalRuns.ranAt, t.evalCases.name);
    return rows.map((r) => ({ ...toRun(r.run), caseName: r.caseName, expectation: r.expectation, agentId: r.agentId }));
  }
}
