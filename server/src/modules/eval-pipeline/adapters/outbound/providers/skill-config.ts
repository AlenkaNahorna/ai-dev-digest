import { and, asc, eq } from 'drizzle-orm';
import type { Container } from '../../../../../platform/container.js';
import * as t from '../../../../../db/schema.js';
import type { AgentInfo, SkillConfigPort, SkillInfo } from '../../../application/ports/eval-ports.js';

/** Reads a skill and the agent it is judged on. Workspace-scoped through `skills` / `agents`. */
export class SkillConfig implements SkillConfigPort {
  constructor(private container: Container) {}

  async getSkill(workspaceId: string, skillId: string): Promise<SkillInfo | undefined> {
    const [row] = await this.container.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.id, skillId), eq(t.skills.workspaceId, workspaceId)));
    return row ? { id: row.id, name: row.name, version: row.version, body: row.body } : undefined;
  }

  async linkedAgent(workspaceId: string, skillId: string): Promise<AgentInfo | undefined> {
    const [row] = await this.container.db
      .select({ agent: t.agents })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(
        and(
          eq(t.agentSkills.skillId, skillId),
          eq(t.agentSkills.enabled, true),
          eq(t.agents.workspaceId, workspaceId),
          eq(t.agents.enabled, true),
        ),
      )
      .orderBy(asc(t.agentSkills.order), asc(t.agents.createdAt))
      .limit(1);
    if (!row) return undefined;
    const a = row.agent;
    return { id: a.id, name: a.name, provider: a.provider, model: a.model, version: a.version, systemPrompt: a.systemPrompt };
  }
}
