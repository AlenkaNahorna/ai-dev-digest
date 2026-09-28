import type { Container } from '../../platform/container.js';
import type { Skill, SkillType, SkillSource, AgentSkillLink } from '@devdigest/shared';
import { SkillsRepository } from './adapters/outbound/persistence/repository.js';

export type SkillInput = { name: string; description: string; type: SkillType; body: string; source?: SkillSource; enabled?: boolean };

export class SkillsService {
  private repo: SkillsRepository;
  constructor(private container: Container) { this.repo = new SkillsRepository(container.db); }

  private dto(row: any, agentCount = 0): Skill {
    return { id: row.id, name: row.name, description: row.description, type: row.type, source: row.source, body: row.body, enabled: row.enabled, version: row.version, evidence_files: row.evidenceFiles ?? null, agent_count: agentCount };
  }
  async list(workspaceId: string) {
    const [rows, counts] = await Promise.all([this.repo.list(workspaceId), this.repo.agentCounts(workspaceId)]);
    return rows.map((r) => this.dto(r, counts.get(r.id) ?? 0));
  }
  async get(workspaceId: string, id: string) { const r = await this.repo.get(workspaceId, id); return r ? this.dto(r) : undefined; }
  async create(workspaceId: string, input: SkillInput) { return this.dto(await this.repo.insert({ workspaceId, name: input.name, description: input.description, type: input.type, source: input.source ?? 'manual', body: input.body, enabled: input.enabled ?? true, version: 1 })); }
  async update(workspaceId: string, id: string, input: Partial<SkillInput>) { const r = await this.repo.update(workspaceId, id, input); return r ? this.dto(r) : undefined; }
  async delete(workspaceId: string, id: string) { return this.repo.remove(workspaceId, id); }
  async versions(workspaceId: string, id: string) { if (!(await this.repo.get(workspaceId, id))) return undefined; return (await this.repo.versions(id)).map((v) => ({ skill_id: v.skillId, version: v.version, body: v.body, created_at: v.createdAt.toISOString() })); }
  async links(agentId: string): Promise<Array<AgentSkillLink & { skill: Skill }>> { return (await this.repo.linked(agentId)).map((x) => ({ agent_id: agentId, skill_id: x.skill.id, order: x.order, enabled: x.enabled, skill: this.dto(x.skill) })); }
  async setLinks(agentId: string, links: Array<{ skill_id: string; order: number; enabled?: boolean }>) { await this.repo.setLinks(agentId, links.map((l) => ({ skillId: l.skill_id, order: l.order, enabled: l.enabled ?? true }))); return this.links(agentId); }
  async promptSkills(agentId: string) { const links = await this.repo.linked(agentId); return links.filter((x) => x.enabled && x.skill.enabled).map((x) => `### ${x.skill.name} · v${x.skill.version}\n\n${x.skill.body}`); }
}
