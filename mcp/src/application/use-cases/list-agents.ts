import { shapeAgents } from '../../domain/agent-shape.js';
import type { AgentsView } from '../../domain/agent-shape.js';
import type { DevDigestApi } from '../ports/devdigest-api.js';

export type ListAgentsApi = Pick<DevDigestApi, 'listAgents'>;

/** `list_agents`: one read, trimmed to name + description + enabled. */
export function createListAgents(api: ListAgentsApi): () => Promise<AgentsView> {
  return async () => shapeAgents(await api.listAgents());
}
