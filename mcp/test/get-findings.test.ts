import { describe, expect, it, vi } from 'vitest';
import { HintError } from '../src/application/errors.js';
import type { AgentRow, ReviewRow } from '../src/application/ports/devdigest-api.js';
import { createGetFindings } from '../src/application/use-cases/get-findings.js';
import type { Resolver } from '../src/application/use-cases/resolve.js';

const security: AgentRow = { id: 'a1', name: 'security', description: '', model: 'gpt-x', enabled: true };
const style: AgentRow = { id: 'a2', name: 'style', description: '', model: 'gpt-x', enabled: true };

const row = (over: Partial<ReviewRow>): ReviewRow => ({
  id: 'r',
  run_id: 'run',
  agent_id: 'a1',
  agent_name: 'security',
  kind: 'review',
  verdict: 'comment',
  score: 80,
  created_at: '2026-10-01T00:00:00Z',
  findings: [],
  ...over,
});

function setup(reviews: ReviewRow[]) {
  const listReviews = vi.fn(async (_pullId: string) => reviews);
  const resolvePull = vi.fn(async (_repo: string, _pr: number) => ({
    repo: { id: 'repo1', owner: 'acme', name: 'payments-api', full_name: 'acme/payments-api' },
    pull: { id: 'pull1', number: 482, title: 'PR' },
  }));
  const resolveAgent = vi.fn(async (name: string) => {
    if (name === 'security') return security;
    if (name === 'style') return style;
    throw new HintError(`Agent '${name}' not found. Call list_agents for valid names.`);
  });
  const handler = createGetFindings({ listReviews }, {
    resolvePull,
    resolveAgent,
  } satisfies Pick<Resolver, 'resolvePull' | 'resolveAgent'>);
  return { handler, listReviews, resolvePull, resolveAgent };
}

const finding = (severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION') => ({
  id: 'f',
  severity,
  title: 'T',
  file: 'a.ts',
  start_line: 1,
  end_line: 2,
  rationale: 'why',
});

describe('get_findings use case', () => {
  it('returns the newest review per agent for the pull', async () => {
    const t = setup([
      row({ id: 'old', run_id: 'run-old', created_at: '2026-10-01T00:00:00Z' }),
      row({ id: 'new', run_id: 'run-new', created_at: '2026-10-02T00:00:00Z', findings: [finding('WARNING')] }),
      row({ id: 'st', agent_id: 'a2', agent_name: 'style', run_id: 'run-st', created_at: '2026-10-01T00:00:00Z' }),
    ]);
    const out = await t.handler({ repo: 'acme/payments-api', pr: 482 });
    expect(t.resolvePull).toHaveBeenCalledWith('acme/payments-api', 482);
    expect(t.listReviews).toHaveBeenCalledWith('pull1');
    expect(t.resolveAgent).not.toHaveBeenCalled();
    expect(out.reviews.map((r) => r.run_id)).toEqual(['run-new', 'run-st']);
    expect(out.reviews[0]?.counts.warning).toBe(1);
  });

  it('filters by agent', async () => {
    const t = setup([
      row({ id: 'sec', run_id: 'run-sec' }),
      row({ id: 'st', agent_id: 'a2', agent_name: 'style', run_id: 'run-st' }),
    ]);
    const out = await t.handler({ repo: 'acme/payments-api', pr: 482, agent: 'style' });
    expect(out.reviews.map((r) => r.run_id)).toEqual(['run-st']);
  });

  it('passes the severity filter through', async () => {
    const t = setup([row({ findings: [finding('SUGGESTION'), finding('CRITICAL')] })]);
    const out = await t.handler({ repo: 'acme/payments-api', pr: 482, severity: 'CRITICAL' });
    expect(out.reviews[0]?.findings.map((f) => f.severity)).toEqual(['CRITICAL']);
    expect(out.reviews[0]?.counts.suggestion).toBe(1);
  });

  it('unknown agent: hint from the resolver, reviews are not read', async () => {
    const t = setup([row({})]);
    await expect(t.handler({ repo: 'acme/payments-api', pr: 482, agent: 'nope' })).rejects.toThrow(
      "Agent 'nope' not found. Call list_agents for valid names.",
    );
    expect(t.listReviews).not.toHaveBeenCalled();
  });

  it('no reviews: hint to call run_agent_on_pr', async () => {
    const t = setup([]);
    const err = await t.handler({ repo: 'acme/payments-api', pr: 482 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HintError);
    expect((err as HintError).message).toContain('run_agent_on_pr');
    expect((err as HintError).message).toContain('PR #482');
  });

  it('only summary rows count as no reviews', async () => {
    const t = setup([row({ kind: 'summary' })]);
    await expect(t.handler({ repo: 'acme/payments-api', pr: 482 })).rejects.toBeInstanceOf(HintError);
  });

  it('agent without a review: hint names the agent and run_agent_on_pr', async () => {
    const t = setup([row({})]);
    const err = await t.handler({ repo: 'acme/payments-api', pr: 482, agent: 'style' }).catch((e: unknown) => e);
    expect((err as HintError).message).toContain("agent 'style'");
    expect((err as HintError).message).toContain('run_agent_on_pr');
  });
});
