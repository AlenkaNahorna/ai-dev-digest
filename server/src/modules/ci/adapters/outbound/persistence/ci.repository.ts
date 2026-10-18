import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../../../../../db/client.js';
import * as t from '../../../../../db/schema.js';
import type {
  CiInstallationRow,
  CiRepositoryPort,
  CiRunListRow,
  ExportableAgent,
  InsertCiRunInput,
  InstallationWithLatest,
  UpsertInstallationInput,
} from '../../../application/ports/ci-repository.js';

/**
 * Drizzle implementation of `CiRepositoryPort` (onion outbound/persistence).
 * Persistence + tenant scoping only — no HTTP shaping, no policy. Uses typed
 * operators (`eq`/`desc`/`asc`), never a bare `Date` in a `sql` template
 * (server/INSIGHTS.md 2026-10-11).
 */
export class CiRepository implements CiRepositoryPort {
  constructor(private db: Db) {}

  async getExportableAgent(workspaceId: string, agentId: string): Promise<ExportableAgent | null> {
    const [agent] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)));
    if (!agent) return null;

    const skillRows = await this.db
      .select({ name: t.skills.name, body: t.skills.body, order: t.agentSkills.order })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order));

    return {
      id: agent.id,
      name: agent.name,
      provider: agent.provider,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      strategy: agent.strategy,
      ciFailOn: agent.ciFailOn,
      skills: skillRows.map((s) => ({ name: s.name, body: s.body })),
    };
  }

  async upsertInstallation(
    input: UpsertInstallationInput,
  ): Promise<{ row: CiInstallationRow; created: boolean }> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(t.ciInstallations)
        .where(
          and(
            eq(t.ciInstallations.agentId, input.agentId),
            eq(t.ciInstallations.repo, input.repo),
          ),
        );
      if (existing) {
        // Re-export reconciles the row but KEEPS the existing token (AC-7):
        // keep target_type current, never overwrite token_hash.
        const [updated] = await tx
          .update(t.ciInstallations)
          .set({ targetType: input.targetType })
          .where(eq(t.ciInstallations.id, existing.id))
          .returning();
        return { row: toInstallationRow(updated ?? existing), created: false };
      }
      const [row] = await tx
        .insert(t.ciInstallations)
        .values({
          agentId: input.agentId,
          repo: input.repo,
          targetType: input.targetType,
          tokenHash: input.tokenHash,
        })
        .returning();
      return { row: toInstallationRow(row!), created: true };
    });
  }

  async listInstallations(
    workspaceId: string,
    agentId: string,
  ): Promise<InstallationWithLatest[]> {
    // Scope to workspace by joining through the agent.
    const rows = await this.db
      .select({
        id: t.ciInstallations.id,
        repo: t.ciInstallations.repo,
        targetType: t.ciInstallations.targetType,
        installedAt: t.ciInstallations.installedAt,
      })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.agentId, agentId)))
      .orderBy(desc(t.ciInstallations.installedAt));

    const out: InstallationWithLatest[] = [];
    for (const r of rows) {
      const [latest] = await this.db
        .select({ verdict: t.ciRuns.verdict, ranAt: t.ciRuns.ranAt })
        .from(t.ciRuns)
        .where(eq(t.ciRuns.ciInstallationId, r.id))
        .orderBy(desc(t.ciRuns.ranAt), desc(t.ciRuns.id))
        .limit(1);
      out.push({
        id: r.id,
        repo: r.repo,
        targetType: r.targetType,
        installedAt: r.installedAt ?? null,
        latestVerdict: latest?.verdict ?? null,
        latestRanAt: latest?.ranAt ?? null,
      });
    }
    return out;
  }

  async findInstallationByTokenHash(tokenHash: string): Promise<CiInstallationRow | null> {
    const [row] = await this.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.tokenHash, tokenHash));
    return row ? toInstallationRow(row) : null;
  }

  async insertCiRun(input: InsertCiRunInput): Promise<{ inserted: boolean }> {
    const rows = await this.db
      .insert(t.ciRuns)
      .values({
        ciInstallationId: input.ciInstallationId,
        prNumber: input.prNumber,
        ranAt: input.ranAt,
        verdict: input.verdict,
        findingsCount: input.findingsCount,
        critical: input.critical,
        warning: input.warning,
        suggestion: input.suggestion,
        costUsd: input.costUsd,
        durationMs: input.durationMs,
        commitSha: input.commitSha,
        runId: input.runId,
        runAttempt: input.runAttempt,
        githubUrl: input.githubUrl,
        source: input.source,
      })
      // AC-18: idempotent on the (installation, run_id, run_attempt) dedupe index.
      .onConflictDoNothing({
        target: [t.ciRuns.ciInstallationId, t.ciRuns.runId, t.ciRuns.runAttempt],
      })
      .returning({ id: t.ciRuns.id });
    return { inserted: rows.length > 0 };
  }

  async listCiRuns(workspaceId: string, limit: number): Promise<CiRunListRow[]> {
    const rows = await this.db
      .select({
        id: t.ciRuns.id,
        ciInstallationId: t.ciRuns.ciInstallationId,
        repo: t.ciInstallations.repo,
        prNumber: t.ciRuns.prNumber,
        ranAt: t.ciRuns.ranAt,
        verdict: t.ciRuns.verdict,
        findingsCount: t.ciRuns.findingsCount,
        critical: t.ciRuns.critical,
        warning: t.ciRuns.warning,
        suggestion: t.ciRuns.suggestion,
        costUsd: t.ciRuns.costUsd,
        durationMs: t.ciRuns.durationMs,
        commitSha: t.ciRuns.commitSha,
        runId: t.ciRuns.runId,
        runAttempt: t.ciRuns.runAttempt,
        githubUrl: t.ciRuns.githubUrl,
        agentName: t.agents.name,
      })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciRuns.ciInstallationId, t.ciInstallations.id))
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(desc(t.ciRuns.ranAt), desc(t.ciRuns.id))
      .limit(limit);
    return rows;
  }
}

function toInstallationRow(row: typeof t.ciInstallations.$inferSelect): CiInstallationRow {
  return {
    id: row.id,
    agentId: row.agentId,
    repo: row.repo,
    targetType: row.targetType,
    tokenHash: row.tokenHash,
    installedAt: row.installedAt ?? null,
  };
}
