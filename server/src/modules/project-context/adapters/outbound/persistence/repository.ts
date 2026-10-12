import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../../../../db/client.js';
import * as t from '../../../../../db/schema.js';
import type { AttachedDoc, LinkedSkillDocs, UsageRow } from '../../../domain/effective-set.js';
import type {
  AttachmentsRepo,
  EffectiveInputs,
  OwnerKind,
  RepoInfo,
  ReposPort,
  UsageRepo,
} from '../../../application/ports/project-context-ports.js';

/**
 * Drizzle persistence for Project Context. Attachment tables carry no
 * `workspace_id`, so every read/write is scoped by joining through the owning
 * agent/skill (and the repo), both of which are workspace-owned.
 */
export class ProjectContextRepository implements ReposPort, AttachmentsRepo, UsageRepo {
  constructor(private readonly db: Db) {}

  async findById(repoId: string): Promise<RepoInfo | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, workspaceId: t.repos.workspaceId, owner: t.repos.owner, name: t.repos.name })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row;
  }

  async ownerInWorkspace(kind: OwnerKind, workspaceId: string, ownerId: string): Promise<boolean> {
    if (kind === 'agent') {
      const rows = await this.db
        .select({ id: t.agents.id })
        .from(t.agents)
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, ownerId)));
      return rows.length > 0;
    }
    const rows = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, ownerId)));
    return rows.length > 0;
  }

  async getDocs(kind: OwnerKind, ownerId: string, repoId: string): Promise<AttachedDoc[]> {
    if (kind === 'agent') {
      return this.db
        .select({ path: t.agentContextDocs.path, order: t.agentContextDocs.order })
        .from(t.agentContextDocs)
        .where(and(eq(t.agentContextDocs.agentId, ownerId), eq(t.agentContextDocs.repoId, repoId)))
        .orderBy(asc(t.agentContextDocs.order));
    }
    return this.db
      .select({ path: t.skillContextDocs.path, order: t.skillContextDocs.order })
      .from(t.skillContextDocs)
      .where(and(eq(t.skillContextDocs.skillId, ownerId), eq(t.skillContextDocs.repoId, repoId)))
      .orderBy(asc(t.skillContextDocs.order));
  }

  async replaceDocs(kind: OwnerKind, ownerId: string, repoId: string, docs: AttachedDoc[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (kind === 'agent') {
        await tx
          .delete(t.agentContextDocs)
          .where(and(eq(t.agentContextDocs.agentId, ownerId), eq(t.agentContextDocs.repoId, repoId)));
        if (docs.length > 0) {
          await tx.insert(t.agentContextDocs).values(docs.map((d) => ({ agentId: ownerId, repoId, path: d.path, order: d.order })));
        }
        return;
      }
      await tx
        .delete(t.skillContextDocs)
        .where(and(eq(t.skillContextDocs.skillId, ownerId), eq(t.skillContextDocs.repoId, repoId)));
      if (docs.length > 0) {
        await tx.insert(t.skillContextDocs).values(docs.map((d) => ({ skillId: ownerId, repoId, path: d.path, order: d.order })));
      }
    });
  }

  async effectiveInputs(workspaceId: string, agentId: string, repoId: string): Promise<EffectiveInputs> {
    const agentDocs = await this.db
      .select({ path: t.agentContextDocs.path, order: t.agentContextDocs.order })
      .from(t.agentContextDocs)
      .innerJoin(t.agents, eq(t.agentContextDocs.agentId, t.agents.id))
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          eq(t.agentContextDocs.agentId, agentId),
          eq(t.agentContextDocs.repoId, repoId),
        ),
      )
      .orderBy(asc(t.agentContextDocs.order));

    // Only ENABLED links to ENABLED skills contribute (same rule as prompt skills).
    const skillRows = await this.db
      .select({
        skillId: t.agentSkills.skillId,
        skillOrder: t.agentSkills.order,
        path: t.skillContextDocs.path,
        order: t.skillContextDocs.order,
      })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .innerJoin(
        t.skillContextDocs,
        and(eq(t.skillContextDocs.skillId, t.skills.id), eq(t.skillContextDocs.repoId, repoId)),
      )
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          eq(t.skills.workspaceId, workspaceId),
          eq(t.agentSkills.agentId, agentId),
          eq(t.agentSkills.enabled, true),
          eq(t.skills.enabled, true),
        ),
      )
      .orderBy(asc(t.agentSkills.order), asc(t.skillContextDocs.order));

    const bySkill = new Map<string, LinkedSkillDocs>();
    for (const r of skillRows) {
      let entry = bySkill.get(r.skillId);
      if (!entry) bySkill.set(r.skillId, (entry = { skillOrder: r.skillOrder, docs: [] }));
      entry.docs.push({ path: r.path, order: r.order });
    }
    return { agentDocs, skills: [...bySkill.values()] };
  }

  async listUsage(workspaceId: string, repoId: string): Promise<{ direct: UsageRow[]; viaSkills: UsageRow[] }> {
    const direct = await this.db
      .select({ agentId: t.agentContextDocs.agentId, path: t.agentContextDocs.path })
      .from(t.agentContextDocs)
      .innerJoin(t.agents, eq(t.agentContextDocs.agentId, t.agents.id))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agentContextDocs.repoId, repoId)));

    const viaSkills = await this.db
      .select({ agentId: t.agentSkills.agentId, path: t.skillContextDocs.path })
      .from(t.skillContextDocs)
      .innerJoin(t.skills, eq(t.skillContextDocs.skillId, t.skills.id))
      .innerJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skills.id))
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(
        and(
          eq(t.skills.workspaceId, workspaceId),
          eq(t.agents.workspaceId, workspaceId),
          eq(t.skillContextDocs.repoId, repoId),
          eq(t.agentSkills.enabled, true),
          eq(t.skills.enabled, true),
        ),
      );
    return { direct, viaSkills };
  }
}
