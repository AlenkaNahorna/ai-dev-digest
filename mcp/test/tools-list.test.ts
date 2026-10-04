import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEncoding } from 'js-tiktoken';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { composeServer } from '../src/compose.js';

// ---- Verbatim texts from docs/plans/2026-10-04-devdigest-mcp.md ("Tool descriptions") ----
const INSTRUCTIONS = 'DevDigest PR review. Start with list_agents.';

const DESCRIPTIONS = {
  list_agents: 'List the review agents configured in DevDigest. Call first to get a valid agent name.',
  run_agent_on_pr:
    'Run one review agent on a pull request and wait for the result (up to 2 min). Returns verdict and findings. Starts a paid LLM run.',
  get_findings:
    'Read verdict and findings of reviews already run on a pull request. Does not start a review.',
  get_conventions:
    'Get the house rules extracted from a repository (latest scan). Use before writing or reviewing code there.',
  get_blast_radius:
    'Show which symbols, callers and endpoints a pull request affects. Not implemented yet.',
} as const;

const PARAM = {
  repo: 'Repository as owner/name',
  pr: 'PR number',
  agentRequired: 'Agent name from list_agents',
  agentOptional: 'Only this agent (name from list_agents)',
  severity: 'Minimum severity',
  category: 'Only this category',
} as const;

const TOKEN_BUDGET = 800;

// Golden payload: any change to a definition must be made here too, so it shows up in the diff.
const EXPECTED_TOOLS = [
  {
    name: 'list_agents',
    description: DESCRIPTIONS.list_agents,
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'run_agent_on_pr',
    description: DESCRIPTIONS.run_agent_on_pr,
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: PARAM.repo },
        pr: { type: 'integer', minimum: 1, description: PARAM.pr },
        agent: { type: 'string', description: PARAM.agentRequired },
      },
      required: ['repo', 'pr', 'agent'],
    },
  },
  {
    name: 'get_findings',
    description: DESCRIPTIONS.get_findings,
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: PARAM.repo },
        pr: { type: 'integer', minimum: 1, description: PARAM.pr },
        agent: { type: 'string', description: PARAM.agentOptional },
        severity: {
          type: 'string',
          enum: ['CRITICAL', 'WARNING', 'SUGGESTION'],
          description: PARAM.severity,
        },
      },
      required: ['repo', 'pr'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_conventions',
    description: DESCRIPTIONS.get_conventions,
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: PARAM.repo },
        category: {
          type: 'string',
          enum: ['naming', 'structure', 'testing', 'error-handling', 'api-contract', 'other'],
          description: PARAM.category,
        },
      },
      required: ['repo'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_blast_radius',
    description: DESCRIPTIONS.get_blast_radius,
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: PARAM.repo },
        pr: { type: 'integer', minimum: 1, description: PARAM.pr },
      },
      required: ['repo', 'pr'],
    },
    annotations: { readOnlyHint: true },
  },
];

type ListedTool = Awaited<ReturnType<Client['listTools']>>['tools'][number];

let client: Client;
let tools: ListedTool[];
let instructions: string | undefined;

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = composeServer({ apiUrl: 'http://127.0.0.1:1', log: () => {} });
  client = new Client({ name: 'tools-list-test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  tools = (await client.listTools()).tools;
  instructions = client.getInstructions();
});

afterAll(async () => {
  await client.close();
});

describe('tools/list contract', () => {
  it('publishes exactly the five planned tools', () => {
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['get_blast_radius', 'get_conventions', 'get_findings', 'list_agents', 'run_agent_on_pr'],
    );
  });

  it('matches the golden payload (names, descriptions, schemas, annotations)', () => {
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    expect([...tools].sort(byName)).toEqual([...EXPECTED_TOOLS].sort(byName));
  });

  it('uses the verbatim server instructions', () => {
    expect(instructions).toBe(INSTRUCTIONS);
  });

  it('keeps every description at or under 200 characters', () => {
    for (const tool of tools) {
      expect(tool.description?.length ?? 0, tool.name).toBeLessThanOrEqual(200);
      expect(tool.description, tool.name).toBe(DESCRIPTIONS[tool.name as keyof typeof DESCRIPTIONS]);
    }
  });

  it('uses flat scalar parameters only, each with a description', () => {
    for (const tool of tools) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
      for (const [name, property] of Object.entries(properties)) {
        expect(['string', 'integer', 'number', 'boolean'], `${tool.name}.${name}`).toContain(
          property['type'],
        );
        expect(property['properties'], `${tool.name}.${name}`).toBeUndefined();
        expect(property['items'], `${tool.name}.${name}`).toBeUndefined();
        expect(typeof property['description'], `${tool.name}.${name}`).toBe('string');
      }
    }
  });

  it('declares no outputSchema and no title', () => {
    for (const tool of tools) {
      expect(tool, tool.name).not.toHaveProperty('outputSchema');
      expect(tool, tool.name).not.toHaveProperty('title');
    }
  });

  it('marks four tools read-only and leaves run_agent_on_pr writable', () => {
    for (const tool of tools) {
      if (tool.name === 'run_agent_on_pr') {
        expect(tool.annotations?.readOnlyHint, tool.name).not.toBe(true);
      } else {
        expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      }
    }
  });

  it(`stays within the ${TOKEN_BUDGET}-token budget (definitions + instructions)`, () => {
    const payload = JSON.stringify({ instructions, tools });
    const tokens = getEncoding('cl100k_base').encode(payload).length;
    expect(tokens, `tools/list payload is ${tokens} tokens`).toBeLessThanOrEqual(TOKEN_BUDGET);
  });
});
