import { describe, expect, it, vi } from 'vitest';
import { ApiError, HintError, toHintMessage } from '../src/application/errors.js';
import type {
  ActiveRunRow,
  DevDigestApi,
  ReviewRow,
  RunRow,
  WaitOutcome,
} from '../src/application/ports/devdigest-api.js';
import { createResolver } from '../src/application/use-cases/resolve.js';
import { createRunAgentOnPr } from '../src/application/use-cases/run-agent-on-pr.js';
import { DEFAULT_WAIT_MS, parseWaitMs } from '../src/domain/wait-budget.js';

const REPO = { id: 'r1', owner: 'acme', name: 'payments-api', full_name: 'acme/payments-api' };
const PULL = { id: 'p1', number: 482, title: 'Add retries' };
const AGENT = { id: 'a1', name: 'Security', description: 'd', enabled: true };

function review(over: Partial<ReviewRow> = {}): ReviewRow {
  return {
    id: 'rv1',
    run_id: 'run1',
    agent_id: 'a1',
    agent_name: 'Security',
    kind: 'review',
    verdict: 'request_changes',
    score: 40,
    created_at: '2026-10-04T10:00:00Z',
    findings: [
      { id: 'f1', severity: 'WARNING', title: 'Weak hash', file: 'a.ts', start_line: 3, end_line: 3, rationale: 'md5' },
      { id: 'f2', severity: 'CRITICAL', title: 'SQL injection', file: 'b.ts', start_line: 9, end_line: 9, rationale: 'concat' },
    ],
    ...over,
  };
}

function run(over: Partial<RunRow> = {}): RunRow {
  return { run_id: 'run1', agent_id: 'a1', agent_name: 'Security', status: 'done', error: null, ran_at: null, ...over };
}

interface Setup {
  active?: ActiveRunRow[];
  outcome?: WaitOutcome;
  reviews?: ReviewRow[];
  runs?: RunRow[];
  startError?: unknown;
}

function setup(opts: Setup = {}, waitMs?: number) {
  const api = {
    listAgents: vi.fn(async () => [AGENT]),
    listRepos: vi.fn(async () => [REPO]),
    listPulls: vi.fn(async () => [PULL]),
    listActiveRuns: vi.fn(async () => opts.active ?? []),
    startReview: vi.fn(async () => {
      if (opts.startError !== undefined) throw opts.startError;
      return { run_id: 'run1', agent_id: 'a1', agent_name: 'Security' };
    }),
    waitForRun: vi.fn(async () => opts.outcome ?? 'finished'),
    listReviews: vi.fn(async () => opts.reviews ?? [review()]),
    listRuns: vi.fn(async () => opts.runs ?? [run()]),
  };
  const resolver = createResolver(api as unknown as DevDigestApi);
  const handler = createRunAgentOnPr(api as unknown as DevDigestApi, resolver, waitMs === undefined ? {} : { waitMs });
  return { api, handler };
}

const INPUT = { repo: 'acme/payments-api', pr: 482, agent: 'security' };

describe('run_agent_on_pr use case', () => {
  it('starts one run, waits, and returns the shaped review of that run', async () => {
    const { api, handler } = setup();
    const out = await handler(INPUT);
    expect(api.startReview).toHaveBeenCalledTimes(1);
    expect(api.startReview).toHaveBeenCalledWith('p1', 'a1');
    expect(api.waitForRun).toHaveBeenCalledWith('run1', { timeoutMs: DEFAULT_WAIT_MS });
    expect(api.listRuns).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      run_id: 'run1',
      agent: 'Security',
      verdict: 'request_changes',
      score: 40,
      counts: { critical: 1, warning: 1, suggestion: 0 },
      more: 0,
    });
    expect((out as { findings: { severity: string }[] }).findings.map((f) => f.severity)).toEqual([
      'CRITICAL',
      'WARNING',
    ]);
  });

  it('ignores reviews of other runs and summary rows', async () => {
    const { handler } = setup({
      reviews: [review({ id: 'old', run_id: 'older', score: 1 }), review({ id: 's', kind: 'summary', score: 2 }), review()],
    });
    expect(await handler(INPUT)).toMatchObject({ run_id: 'run1', score: 40 });
  });

  it('passes the configured wait limit to waitForRun', async () => {
    const { api, handler } = setup({}, 45_000);
    await handler(INPUT);
    expect(api.waitForRun).toHaveBeenCalledWith('run1', { timeoutMs: 45_000 });
  });

  it('returns the running hint when the budget is exhausted, without reading results', async () => {
    const { api, handler } = setup({ outcome: 'timeout' });
    expect(await handler(INPUT)).toEqual({
      run_id: 'run1',
      status: 'running',
      hint: 'Still running. Call get_findings for this PR in ~30s.',
    });
    expect(api.listReviews).not.toHaveBeenCalled();
  });

  it('reports a failed run with its error and next step', async () => {
    const { api, handler } = setup({
      reviews: [],
      runs: [run({ status: 'failed', error: 'LLM provider\nunavailable' })],
    });
    const err = await handler(INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HintError);
    expect((err as Error).message).toBe(
      'Run run1 failed: LLM provider unavailable. Call run_agent_on_pr again or pick another agent.',
    );
    expect(api.listRuns).toHaveBeenCalledTimes(1);
  });

  it('reports a cancelled run', async () => {
    const { handler } = setup({ reviews: [], runs: [run({ status: 'cancelled', error: 'Cancelled by user' })] });
    await expect(handler(INPUT)).rejects.toThrow(/Run run1 was cancelled/);
  });

  it('degrades to the running hint when the stream ended but the run is still running', async () => {
    const { handler } = setup({ reviews: [], runs: [run({ status: 'running' })] });
    expect(await handler(INPUT)).toMatchObject({ run_id: 'run1', status: 'running' });
  });

  it('explains a finished run without a saved review', async () => {
    const { handler } = setup({ reviews: [], runs: [run({ status: 'done' })] });
    await expect(handler(INPUT)).rejects.toThrow(/finished but no review was saved/);
  });

  it('attaches to a run of the same agent already in flight (no second paid run)', async () => {
    const { api, handler } = setup({
      active: [
        { run_id: 'other', agent_id: 'a2', agent_name: 'Perf', ran_at: null },
        { run_id: 'run1', agent_id: 'a1', agent_name: 'Security', ran_at: null },
      ],
    });
    const out = await handler(INPUT);
    expect(api.startReview).not.toHaveBeenCalled();
    expect(api.waitForRun).toHaveBeenCalledWith('run1', expect.anything());
    expect(out).toMatchObject({ run_id: 'run1' });
  });

  it('starts a run when only other agents are in flight', async () => {
    const { api, handler } = setup({ active: [{ run_id: 'other', agent_id: 'a2', agent_name: 'Perf', ran_at: null }] });
    await handler(INPUT);
    expect(api.startReview).toHaveBeenCalledTimes(1);
  });

  it('maps a 429 from the start request to the rate-limit hint', async () => {
    const { api, handler } = setup({
      startError: new ApiError('http', { baseUrl: 'http://x', status: 429, code: 'rate_limited', apiMessage: 'Rate limit exceeded' }),
    });
    const err = await handler(INPUT).catch((e: unknown) => e);
    expect(api.waitForRun).not.toHaveBeenCalled();
    expect(toHintMessage(err, () => undefined)).toBe(
      'Review rate limit reached (10/min). Wait a minute before calling run_agent_on_pr again.',
    );
  });

  it('fails on an unknown agent before any run is started', async () => {
    const { api, handler } = setup();
    await expect(handler({ ...INPUT, agent: 'nobody' })).rejects.toThrow(
      "Agent 'nobody' not found. Call list_agents for valid names.",
    );
    expect(api.listActiveRuns).not.toHaveBeenCalled();
    expect(api.startReview).not.toHaveBeenCalled();
  });

  it('fails on an unknown PR before any run is started', async () => {
    const { api, handler } = setup();
    await expect(handler({ ...INPUT, pr: 999 })).rejects.toThrow(/PR #999 is not imported/);
    expect(api.startReview).not.toHaveBeenCalled();
  });
});

describe('parseWaitMs', () => {
  it('defaults when unset or blank', () => {
    expect(parseWaitMs(undefined)).toBe(120_000);
    expect(parseWaitMs('  ')).toBe(120_000);
  });
  it('accepts sane integers', () => {
    expect(parseWaitMs('30000')).toBe(30_000);
    expect(parseWaitMs(' 1000 ')).toBe(1_000);
  });
  it.each(['0', '-5', '12.5', '1e5', 'abc', '999', '600001', '99999999999'])('rejects %s', (raw) => {
    expect(() => parseWaitMs(raw)).toThrow(/DEVDIGEST_MCP_WAIT_MS/);
  });
});
