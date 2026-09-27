import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../../../../../db/client.js';
import * as t from '../../../../../db/schema.js';

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string) {
    return this.db.select().from(t.skills).where(eq(t.skills.workspaceId, workspaceId)).orderBy(asc(t.skills.name));
  }

  async get(workspaceId: string, id: string) {
    const [row] = await this.db.select().from(t.skills).where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  async insert(values: typeof t.skills.$inferInsert) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(t.skills).values(values).returning();
      await tx.insert(t.skillVersions).values({ skillId: row!.id, version: row!.version, body: row!.body });
      return row!;
    });
  }

  async update(workspaceId: string, id: string, patch: Partial<typeof t.skills.$inferInsert>) {
    const existing = await this.get(workspaceId, id);
    if (!existing) return undefined;
    const bodyChanged = patch.body !== undefined && patch.body !== existing.body;
    const version = bodyChanged ? existing.version + 1 : existing.version;
    return this.db.transaction(async (tx) => {
      const [row] = await tx.update(t.skills).set({ ...patch, ...(bodyChanged ? { version } : {}) })
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id))).returning();
      if (row && bodyChanged) await tx.insert(t.skillVersions).values({ skillId: row.id, version, body: row.body });
      return row;
    });
  }

  async remove(workspaceId: string, id: string) {
    const rows = await this.db.delete(t.skills).where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id))).returning({ id: t.skills.id });
    return rows.length > 0;
  }

  async versions(skillId: string) {
    return this.db.select().from(t.skillVersions).where(eq(t.skillVersions.skillId, skillId)).orderBy(desc(t.skillVersions.version));
  }

  async linked(agentId: string) {
    return this.db.select({ skill: t.skills, order: t.agentSkills.order, enabled: t.agentSkills.enabled })
      .from(t.agentSkills).innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId)).orderBy(asc(t.agentSkills.order));
  }

  async setLinks(agentId: string, links: Array<{ skillId: string; order: number; enabled: boolean }>) {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
      if (links.length) await tx.insert(t.agentSkills).values(links.map((l) => ({ agentId, skillId: l.skillId, order: l.order, enabled: l.enabled })));
    });
  }
}
