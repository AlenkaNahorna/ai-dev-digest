import { describe, expect, it, vi } from 'vitest';
import { HintError } from '../src/application/errors.js';
import type { McpTool, ToolResult } from '../src/adapters/inbound/mcp/define-tool.js';
import { createGetBlastRadiusTool } from '../src/adapters/inbound/mcp/get-blast-radius.js';
import { createGetConventionsTool } from '../src/adapters/inbound/mcp/get-conventions.js';
import { createGetFindingsTool } from '../src/adapters/inbound/mcp/get-findings.js';
import { createListAgentsTool } from '../src/adapters/inbound/mcp/list-agents.js';
import { createRunAgentOnPrTool } from '../src/adapters/inbound/mcp/run-agent-on-pr.js';

const log = () => {};
const text = (result: ToolResult) => result.content.map((c) => c.text).join('');

type AnyHandler = (args: Record<string, unknown>) => Promise<unknown>;

interface Case {
  name: string;
  valid: Record<string, unknown>;
  invalid: unknown[];
  make: (handler?: AnyHandler) => McpTool;
}

const cases: Case[] = [
  {
    name: 'list_agents',
    valid: {},
    invalid: ['not-an-object'],
    make: (handler) => createListAgentsTool({ log, ...(handler ? { handler } : {}) }),
  },
  {
    name: 'run_agent_on_pr',
    valid: { repo: 'acme/payments-api', pr: 482, agent: 'security' },
    invalid: [
      { repo: 'acme', pr: 482, agent: 'security' },
      { repo: 'acme/payments-api', pr: 0, agent: 'security' },
      { repo: 'acme/payments-api', pr: 1.5, agent: 'security' },
      { repo: 'acme/payments-api', pr: '482', agent: 'security' },
      { repo: 'acme/payments-api', pr: 482, agent: '  ' },
      { repo: 'acme/payments-api', pr: 482 },
    ],
    make: (handler) => createRunAgentOnPrTool({ log, ...(handler ? { handler } : {}) }),
  },
  {
    name: 'get_findings',
    valid: { repo: 'acme/payments-api', pr: 482, agent: 'security', severity: 'WARNING' },
    invalid: [
      { repo: 'acme/payments-api', pr: -3 },
      { repo: 'acme/payments-api', pr: 482, severity: 'LOW' },
      { repo: '../etc/passwd', pr: 482 },
    ],
    make: (handler) => createGetFindingsTool({ log, ...(handler ? { handler } : {}) }),
  },
  {
    name: 'get_conventions',
    valid: { repo: 'acme/payments-api', category: 'naming' },
    invalid: [
      { repo: 'acme/payments-api', category: 'style' },
      { repo: 'acme/pay ments' },
      { repo: 'acme/payments-api\n' },
    ],
    make: (handler) => createGetConventionsTool({ log, ...(handler ? { handler } : {}) }),
  },
];

describe.each(cases)('$name tool adapter', ({ name, valid, invalid, make }) => {
  it('passes valid arguments to the wired handler and returns compact JSON', async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    const result = await make(handler).call(valid);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeUndefined();
    expect(text(result)).toBe('{"ok":true}');
  });

  it.each(invalid.map((args) => [JSON.stringify(args), args] as const))(
    'rejects invalid arguments %s without calling the handler',
    async (_label, args) => {
      const handler = vi.fn(async () => ({}));
      const result = await make(handler).call(args);
      expect(handler).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/^Invalid arguments: /);
    },
  );

  it('answers "not implemented" as an error result while no use case is wired', async () => {
    const result = await make().call(valid);
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(`${name} is not implemented yet. Do not retry; continue without it.`);
  });

  it('turns a HintError into an error result with its message', async () => {
    const result = await make(async () => {
      throw new HintError('Agent x not found.');
    }).call(valid);
    expect(result).toEqual({ content: [{ type: 'text', text: 'Agent x not found.' }], isError: true });
  });
});

describe('get_blast_radius stub', () => {
  const tool = createGetBlastRadiusTool({ log });

  it('returns the verbatim stub text as an error result', async () => {
    const result = await tool.call({ repo: 'acme/payments-api', pr: 482 });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      'get_blast_radius is not implemented yet. Do not retry; continue without it.',
    );
  });

  it('still validates its input', async () => {
    const result = await tool.call({ repo: 'nope', pr: 482 });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^Invalid arguments: repo must look like owner\/name/);
  });
});
