import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../../../../../db/client.js';
import * as t from '../../../../../db/schema.js';
import type { MemoryExportEntry } from '../../../domain/memory.js';
import type {
  CiInstallationRow,
  CiRepositoryPort,
  CiRunListRow,
  ExportableAgent,
  IngestInstallation,
  InsertCiRunInput,
  InstallationWithLatest,
  MirrorAgentRunInput,
  UpsertInstallationInput,
} from '../../../application/ports/ci-repository.js';

/**
 * Drizzle implementation of `CiRepositoryPort` (onion outbound/persistence).
 * Persistence + tenant scoping only — no HTTP shaping, no policy. Uses typed
 * operators (`eq`/`desc`/`asc`), never a bare `Date` in a `sql` template
 * (server/INSIGHTS.md 2026-10-11).
 */
/** Bound on exported memory entries so a huge memory never bloats the PR. */
const MEMORY_EXPORT_LIMIT = 200;

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
        // refresh target_type + export provenance, never overwrite token_hash.
        const [updated] = await tx
          .update(t.ciInstallations)
          .set({
            targetType: input.targetType,
            workflowVersion: input.workflowVersion,
            postAs: input.postAs,
            triggers: input.triggers,
            prUrl: input.prUrl ?? existing.prUrl,
          })
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
          workflowVersion: input.workflowVersion,
          postAs: input.postAs,
          triggers: input.triggers,
          prUrl: input.prUrl,
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
        workflowVersion: t.ciInstallations.workflowVersion,
        postAs: t.ciInstallations.postAs,
        triggers: t.ciInstallations.triggers,
        prUrl: t.ciInstallations.prUrl,
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
        workflowVersion: r.workflowVersion ?? null,
        postAs: r.postAs ?? null,
        triggers: r.triggers ?? null,
        prUrl: r.prUrl ?? null,
        latestVerdict: latest?.verdict ?? null,
        latestRanAt: latest?.ranAt ?? null,
      });
    }
    return out;
  }

  async findInstallationByTokenHash(tokenHash: string): Promise<IngestInstallation | null> {
    const [row] = await this.db
      .select({
        inst: t.ciInstallations,
        workspaceId: t.agents.workspaceId,
        provider: t.agents.provider,
        model: t.agents.model,
        ciFailOn: t.agents.ciFailOn,
      })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(eq(t.ciInstallations.tokenHash, tokenHash));
    if (!row) return null;
    return {
      ...toInstallationRow(row.inst),
      workspaceId: row.workspaceId,
      agentProvider: row.provider,
      agentModel: row.model,
      agentCiFailOn: row.ciFailOn,
    };
  }

  async insertCiRun(
    input: InsertCiRunInput,
    mirror?: MirrorAgentRunInput,
  ): Promise<{ inserted: boolean }> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
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
      const inserted = rows.length > 0;

      // Mirror into `agent_runs` (source = 'ci') only for a NEW ci_runs row, in the
      // same transaction — a replay therefore never double-counts the run.
      if (inserted && mirror) {
        let prId: string | null = null;
        if (mirror.prNumber != null) {
          const [pr] = await tx
            .select({ id: t.pullRequests.id })
            .from(t.pullRequests)
            .innerJoin(t.repos, eq(t.pullRequests.repoId, t.repos.id))
            .where(
              and(
                eq(t.repos.workspaceId, mirror.workspaceId),
                eq(t.repos.fullName, mirror.repo),
                eq(t.pullRequests.number, mirror.prNumber),
              ),
            );
          prId = pr?.id ?? null;
        }
        await tx.insert(t.agentRuns).values({
          workspaceId: mirror.workspaceId,
          agentId: mirror.agentId,
          prId,
          ranAt: mirror.ranAt,
          provider: mirror.provider,
          model: mirror.model,
          durationMs: mirror.durationMs,
          costUsd: mirror.costUsd,
          status: mirror.status,
          source: 'ci',
          findingsCount: mirror.findingsCount,
          blockers: mirror.blockers,
        });
      }
      return { inserted };
    });
  }

  async listCiRuns(
    workspaceId: string,
    limit: number,
    filter: { agentId?: string } = {},
  ): Promise<CiRunListRow[]> {
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
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          filter.agentId ? eq(t.agents.id, filter.agentId) : undefined,
        ),
      )
      .orderBy(desc(t.ciRuns.ranAt), desc(t.ciRuns.id))
      .limit(limit);
    return rows;
  }

  async listMemoryForExport(workspaceId: string, repoFullName: string): Promise<MemoryExportEntry[]> {
    // Repo-scoped memory only for the studio repo that matches the export target.
    const repoRows = await this.db
      .select({ id: t.repos.id })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, repoFullName)));
    const repoIds = repoRows.map((r) => r.id);

    const scopeFilter =
      repoIds.length > 0
        ? or(
            inArray(t.memory.scope, ['global', 'team']),
            and(eq(t.memory.scope, 'repo'), inArray(t.memory.repoId, repoIds)),
          )
        : inArray(t.memory.scope, ['global', 'team']);

    const rows = await this.db
      .select({
        scope: t.memory.scope,
        kind: t.memory.kind,
        content: t.memory.content,
        confidence: t.memory.confidence,
      })
      .from(t.memory)
      .where(and(eq(t.memory.workspaceId, workspaceId), scopeFilter))
      .orderBy(desc(t.memory.updatedAt), desc(t.memory.id))
      .limit(MEMORY_EXPORT_LIMIT);
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
    workflowVersion: row.workflowVersion ?? null,
    postAs: row.postAs ?? null,
    triggers: row.triggers ?? null,
    prUrl: row.prUrl ?? null,
  };
}
