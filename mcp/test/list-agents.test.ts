import { describe, expect, it, vi } from 'vitest';
import { createListAgentsTool } from '../src/adapters/inbound/mcp/list-agents.js';
import type { AgentRow } from '../src/application/ports/devdigest-api.js';
import { createListAgents } from '../src/application/use-cases/list-agents.js';
import { AGENTS_MAX, AGENT_DESCRIPTION_MAX, shapeAgents } from '../src/domain/agent-shape.js';

const agent = (name: string, description = 'd', enabled = true): AgentRow => ({
  id: `id-${name}`,
  name,
  description,
  enabled,
});

describe('domain/agent-shape', () => {
  it('keeps name, description and enabled only', () => {
    const view = shapeAgents([agent('security', 'Finds vulns', false)]);
    expect(view).toEqual({ agents: [{ name: 'security', description: 'Finds vulns', enabled: false }] });
    expect(JSON.stringify(view)).not.toContain('id-security');
  });

  it('cuts descriptions to 120 chars with an ellipsis', () => {
    const [first] = shapeAgents([agent('a', 'x'.repeat(500))]).agents;
    expect(first?.description).toHaveLength(AGENT_DESCRIPTION_MAX);
    expect(first?.description.endsWith('…')).toBe(true);
  });

  it('keeps a short description untouched and flattens newlines', () => {
    const [first] = shapeAgents([agent('a', 'line1\nline2')]).agents;
    expect(first?.description).toBe('line1 line2');
  });

  it('caps the number of agents and reports `more`', () => {
    const rows = Array.from({ length: AGENTS_MAX + 3 }, (_, i) => agent(`a${i}`));
    const view = shapeAgents(rows);
    expect(view.agents).toHaveLength(AGENTS_MAX);
    expect(view.more).toBe(3);
  });

  it('omits `more` when nothing was cut and handles an empty list', () => {
    expect(shapeAgents([])).toEqual({ agents: [] });
  });
});

describe('list_agents use case + tool', () => {
  it('returns the shaped agents as compact JSON, never leaking ids', async () => {
    const listAgents = vi.fn(async () => [agent('security', 'S'), agent('style', 'T', false)]);
    const tool = createListAgentsTool({ log: () => {}, handler: createListAgents({ listAgents }) });
    const result = await tool.call({});
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? '';
    expect(JSON.parse(text)).toEqual({
      agents: [
        { name: 'security', description: 'S', enabled: true },
        { name: 'style', description: 'T', enabled: false },
      ],
    });
    expect(text).not.toContain('id-');
    expect(listAgents).toHaveBeenCalledTimes(1);
  });
});
