import type { Container } from '../../../../../platform/container.js';
import type { AgentRow } from '../../../../../db/rows.js';
import type { AgentConfigPort, AgentInfo } from '../../../application/ports/eval-ports.js';

function toInfo(row: AgentRow): AgentInfo {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    model: row.model,
    version: row.version,
    systemPrompt: row.systemPrompt,
  };
}

/** Reads agents and their immutable config snapshots through the shared agents repository. */
export class AgentConfig implements AgentConfigPort {
  constructor(private container: Container) {}

  async getAgent(workspaceId: string, agentId: string): Promise<AgentInfo | undefined> {
    const row = await this.container.agentsRepo.getById(workspaceId, agentId);
    return row ? toInfo(row) : undefined;
  }

  async listAgents(workspaceId: string): Promise<AgentInfo[]> {
    return (await this.container.agentsRepo.list(workspaceId)).map(toInfo);
  }

  async getVersionConfig(agentId: string, version: number) {
    const row = await this.container.agentsRepo.getVersion(agentId, version);
    if (!row) return undefined;
    const cfg = (row.configJson ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    return { provider: str(cfg.provider), model: str(cfg.model), systemPrompt: str(cfg.system_prompt) };
  }
}
