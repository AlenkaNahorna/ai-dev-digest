import { clipText } from './text.js';

/** Bounds for `list_agents` (agent names/descriptions are user-authored, so untrusted). */
export const AGENT_DESCRIPTION_MAX = 120;
export const AGENT_NAME_MAX = 100;
export const AGENT_ID_MAX = 64;
export const AGENT_MODEL_MAX = 60;
export const AGENTS_MAX = 100;

export interface AgentInput {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly model: string;
  readonly enabled: boolean;
}

export interface AgentView {
  /** Pass this (or the name) as `agent` to `run_agent_on_pr`; unlike names, ids are unique. */
  id: string;
  name: string;
  description: string;
  model: string;
  enabled: boolean;
}

export interface AgentsView {
  agents: AgentView[];
  /** Agents cut by the cap; omitted when nothing was cut. */
  more?: number;
}

/** Id + name + description (cut) + model + enabled. Nothing else from the API row survives. */
export function shapeAgents(rows: readonly AgentInput[]): AgentsView {
  const agents = rows.slice(0, AGENTS_MAX).map((row) => ({
    id: clipText(row.id, AGENT_ID_MAX),
    name: clipText(row.name, AGENT_NAME_MAX),
    description: clipText(row.description, AGENT_DESCRIPTION_MAX),
    model: clipText(row.model, AGENT_MODEL_MAX),
    enabled: row.enabled,
  }));
  const cut = rows.length - agents.length;
  return cut > 0 ? { agents, more: cut } : { agents };
}
