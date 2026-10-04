import { clipText } from './text.js';

/** Bounds for `list_agents` (agent names/descriptions are user-authored, so untrusted). */
export const AGENT_DESCRIPTION_MAX = 120;
export const AGENT_NAME_MAX = 100;
export const AGENTS_MAX = 100;

export interface AgentInput {
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
}

export interface AgentView {
  name: string;
  description: string;
  enabled: boolean;
}

export interface AgentsView {
  agents: AgentView[];
  /** Agents cut by the cap; omitted when nothing was cut. */
  more?: number;
}

/** Name + description (cut) + enabled. Nothing else from the API row survives. */
export function shapeAgents(rows: readonly AgentInput[]): AgentsView {
  const agents = rows.slice(0, AGENTS_MAX).map((row) => ({
    name: clipText(row.name, AGENT_NAME_MAX),
    description: clipText(row.description, AGENT_DESCRIPTION_MAX),
    enabled: row.enabled,
  }));
  const cut = rows.length - agents.length;
  return cut > 0 ? { agents, more: cut } : { agents };
}
