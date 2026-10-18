import { describe, it, expect } from 'vitest';
import { computeGroups, shouldGroup, type GroupingFinding } from '../src/modules/reviews/multi-agent/grouping.js';
import { computeConflicts, type ConflictAgent } from '../src/modules/reviews/multi-agent/conflicts.js';
import { buildMultiAgentRun, wallClockMs } from '../src/modules/reviews/multi-agent/build-results.js';
import { LINE_TOLERANCE } from '../src/modules/reviews/multi-agent/constants.js';
import { MultiAgentRun } from '@devdigest/shared';
import type {
  MultiAgentParentRow,
  MultiAgentRunRow,
  SingleAgentBaselineRow,
} from '../src/modules/reviews/adapters/outbound/persistence/run.repo.js';

// ---------------------------------------------------------------- grouping

const f = (over: Partial<GroupingFinding> & Pick<GroupingFinding, 'id' | 'agentId'>): GroupingFinding => ({
  file: 'src/middleware/ratelimit.ts',
  startLine: 52,
  endLine: 52,
  category: 'bug',
  title: 'Retry-After header omitted on 429',
  ...over,
});

describe('multi-agent grouping (AC-22..AC-28)', () => {
  it('groups the same issue flagged by two different agents and keeps every original id', () => {
    const groups = computeGroups([
      f({ id: 'sec-1', agentId: 'security' }),
      f({ id: 'cf-1', agentId: 'customer', title: 'Retry-After header omitted on 429 responses' }),
    ]);
    expect(groups).toEqual([{ finding_ids: ['sec-1', 'cf-1'] }]);
  });

  it('never groups two findings of the same agent (AC-26)', () => {
    const groups = computeGroups([
      f({ id: 'a-1', agentId: 'security' }),
      f({ id: 'a-2', agentId: 'security' }),
    ]);
    expect(groups).toEqual([{ finding_ids: ['a-1'] }, { finding_ids: ['a-2'] }]);
  });

  it('respects LINE_TOLERANCE and the file boundary', () => {
    const base = f({ id: 'x', agentId: 'a' });
    expect(shouldGroup(base, f({ id: 'y', agentId: 'b', startLine: 52 + LINE_TOLERANCE, endLine: 52 + LINE_TOLERANCE }))).toBe(true);
    expect(shouldGroup(base, f({ id: 'y', agentId: 'b', startLine: 52 + LINE_TOLERANCE + 1, endLine: 60 }))).toBe(false);
    expect(shouldGroup(base, f({ id: 'y', agentId: 'b', file: 'src/other.ts' }))).toBe(false);
  });

  it('keeps findings apart when neither category nor title is similar enough (AC-28)', () => {
    const groups = computeGroups([
      f({ id: 'a', agentId: 'security', category: 'security', title: 'Hardcoded secret' }),
      f({ id: 'b', agentId: 'perf', category: 'performance', title: 'N+1 query in loop' }),
    ]);
    expect(groups).toEqual([{ finding_ids: ['a'] }, { finding_ids: ['b'] }]);
  });

  it('groups on title similarity when the categories differ', () => {
    const groups = computeGroups([
      f({ id: 'a', agentId: 'one', category: 'bug', title: 'Magic number 3600 in limiter' }),
      f({ id: 'b', agentId: 'two', category: 'style', title: 'Magic number 3600 limiter' }),
    ]);
    expect(groups).toEqual([{ finding_ids: ['a', 'b'] }]);
  });

  it('is deterministic: the same input always yields the same groups in the same order', () => {
    const input = [
      f({ id: '1', agentId: 'a' }),
      f({ id: '2', agentId: 'b' }),
      f({ id: '3', agentId: 'c', file: 'src/x.ts' }),
      f({ id: '4', agentId: 'a', file: 'src/x.ts', category: 'perf', title: 'Other' }),
    ];
    const first = computeGroups(input);
    for (let i = 0; i < 20; i += 1) expect(computeGroups(input)).toEqual(first);
    // every finding is in exactly one group
    expect(first.flatMap((g) => g.finding_ids).sort()).toEqual(['1', '2', '3', '4']);
  });
});

// --------------------------------------------------------------- conflicts

const agent = (over: Partial<ConflictAgent> & Pick<ConflictAgent, 'agentId'>): ConflictAgent => ({
  agentName: over.agentId,
  completed: true,
  findings: [],
  ...over,
});

describe('multi-agent conflicts (AC-29..AC-34)', () => {
  it('flags a location one agent reported and a completed agent did not', () => {
    const conflicts = computeConflicts([
      agent({ agentId: 'mentor', findings: [{ file: 'a.ts', line: 28, title: 'Magic number', severity: 'SUGGESTION' }] }),
      agent({ agentId: 'security' }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.is_conflict).toBe(true);
    expect(conflicts[0]!.takes.map((t) => [t.agent_id, t.verdict])).toEqual([
      ['mentor', 'SUGGESTION'],
      ['security', 'ignored'],
    ]);
  });

  it('a failed or still-running agent is no_result: it can neither create nor resolve a conflict (AC-31)', () => {
    const flagged = [{ file: 'a.ts', line: 1, title: 'T', severity: 'WARNING' as const }];
    // only a failed agent "disagrees" -> the location is listed but is NOT a conflict
    const lonely = computeConflicts([agent({ agentId: 'a', findings: flagged }), agent({ agentId: 'b', completed: false })]);
    expect(lonely).toHaveLength(1);
    expect(lonely[0]!.is_conflict).toBe(false);
    // a completed agent still creates the conflict, and the failed one is reported as no_result
    const c = computeConflicts([
      agent({ agentId: 'a', findings: flagged }),
      agent({ agentId: 'b', completed: false }),
      agent({ agentId: 'c' }),
    ]);
    expect(c).toHaveLength(1);
    expect(c[0]!.is_conflict).toBe(true);
    expect(c[0]!.takes.find((t) => t.agent_id === 'b')!.verdict).toBe('no_result');
  });

  it('lists a location where every reviewing agent agreed, marked is_conflict=false (so "Show only conflicts" can hide it, AC-33)', () => {
    const flagged = [{ file: 'a.ts', line: 1, title: 'T', severity: 'WARNING' as const }];
    const c = computeConflicts([agent({ agentId: 'a', findings: flagged }), agent({ agentId: 'b', findings: flagged })]);
    expect(c).toHaveLength(1);
    expect(c[0]!.is_conflict).toBe(false);
  });

  it('reports severities two levels apart as a conflict', () => {
    const c = computeConflicts([
      agent({ agentId: 'a', findings: [{ file: 'a.ts', line: 1, title: 'T', severity: 'CRITICAL' }] }),
      agent({ agentId: 'b', findings: [{ file: 'a.ts', line: 1, title: 'T', severity: 'SUGGESTION' }] }),
    ]);
    expect(c).toHaveLength(1);
    expect(c[0]!.is_conflict).toBe(true);
  });

  it('"did not flag" note is neutral derived text, never model output (AC-34)', () => {
    const c = computeConflicts([
      agent({ agentId: 'a', findings: [{ file: 'a.ts', line: 1, title: '<script>alert(1)</script>', severity: 'WARNING' }] }),
      agent({ agentId: 'Security' }),
    ]);
    expect(c[0]!.takes.find((t) => t.agent_id === 'Security')!.note).toBe('No finding reported by Security at this location');
  });
});

// ------------------------------------------------------------ build results

const T0 = new Date('2026-10-18T10:00:00.000Z');
const parent: MultiAgentParentRow = { id: 'parent-1', prId: 'pr-1', prNumber: 482, ranAt: T0 };

type RunOver = {
  id: string;
  agentId: string;
  status: string;
  startOffsetMs?: number;
  durationMs?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costUsd?: number | null;
  error?: string | null;
  findings?: { id: string; title: string; line: number; severity?: string; category?: string }[];
};

function row(o: RunOver): MultiAgentRunRow {
  const run = {
    id: o.id,
    agentId: o.agentId,
    status: o.status,
    ranAt: new Date(T0.getTime() + (o.startOffsetMs ?? 0)),
    provider: 'openai',
    model: 'gpt-4.1',
    durationMs: o.durationMs ?? null,
    tokensIn: o.tokensIn ?? null,
    tokensOut: o.tokensOut ?? null,
    costUsd: o.costUsd ?? null,
    score: o.status === 'done' ? 70 : null,
    error: o.error ?? null,
  } as unknown as MultiAgentRunRow['run'];
  const findings = (o.findings ?? []).map(
    (x) =>
      ({
        id: x.id,
        severity: x.severity ?? 'WARNING',
        category: x.category ?? 'bug',
        title: x.title,
        file: 'src/a.ts',
        startLine: x.line,
        endLine: x.line,
        rationale: 'why',
        suggestion: null,
        confidence: 0.9,
        kind: 'finding',
        acceptedAt: null,
        dismissedAt: null,
      }) as unknown as MultiAgentRunRow['findings'][number],
  );
  return {
    run,
    agentName: `Agent ${o.agentId}`,
    review: o.status === 'done' ? { id: `rv-${o.id}`, verdict: 'comment', summary: 'ok', score: 70 } : null,
    findings,
  };
}

describe('buildMultiAgentRun (AC-18..20, 39, 48..52)', () => {
  it('output conforms to the shared MultiAgentRun contract', () => {
    const run = buildMultiAgentRun(parent, [row({ id: 'r1', agentId: 'a', status: 'done', durationMs: 1000, costUsd: 0.01 })]);
    expect(() => MultiAgentRun.parse(run)).not.toThrow();
  });

  it('failure isolation: one failed column carries its status while the others keep their results', () => {
    const run = buildMultiAgentRun(parent, [
      row({ id: 'r1', agentId: 'a', status: 'done', durationMs: 4000, tokensIn: 100, tokensOut: 10, costUsd: 0.02, findings: [{ id: 'f1', title: 'Bug', line: 5 }] }),
      row({ id: 'r2', agentId: 'b', status: 'failed', durationMs: 500, error: 'provider 500' }),
      row({ id: 'r3', agentId: 'c', status: 'done', durationMs: 3000, tokensIn: 80, tokensOut: 8, costUsd: 0.01 }),
    ]);
    expect(run.status).toBe('partial');
    expect(run.columns.map((c) => c.status)).toEqual(['done', 'failed', 'done']);
    expect(run.columns[0]!.findings).toHaveLength(1);
    expect(run.columns[1]!.findings).toHaveLength(0);
    // the failed agent is "no_result", never a silent "did not flag" (AC-31)
    run.conflicts.forEach((c) => expect(c.takes.find((t) => t.agent_id === 'b')?.verdict).not.toBe('ignored'));
    run.conflicts.forEach((c) => expect(c.is_conflict).toBe(true));
  });

  it('cost honesty: total = sum of known costs; unknown cost is excluded, not $0 (AC-49, AC-52)', () => {
    const run = buildMultiAgentRun(parent, [
      row({ id: 'r1', agentId: 'a', status: 'done', durationMs: 1000, costUsd: 0.06 }),
      row({ id: 'r2', agentId: 'b', status: 'done', durationMs: 1000, costUsd: 0.05 }),
      row({ id: 'r3', agentId: 'c', status: 'failed', durationMs: 10, costUsd: null }),
    ]);
    expect(run.total_cost_usd).toBeCloseTo(0.11, 10);
    expect(run.comparison.cost_usd).toBeCloseTo(0.11, 10);
    expect(run.comparison.cost_unknown_agents).toBe(1);
    expect(run.columns[2]!.cost_usd).toBeNull();
  });

  it('total cost is null (not 0) when no run has a known cost', () => {
    const run = buildMultiAgentRun(parent, [row({ id: 'r1', agentId: 'a', status: 'failed', durationMs: 10 })]);
    expect(run.total_cost_usd).toBeNull();
  });

  it('wall-clock is the real elapsed time, not the sum of agent durations (AC-50)', () => {
    // three agents ran concurrently: 0-8s, 0-7s, 0-6.9s  => wall-clock 8s, sequential sum 21.9s
    const rows = [
      row({ id: 'r1', agentId: 'a', status: 'done', startOffsetMs: 0, durationMs: 8000 }),
      row({ id: 'r2', agentId: 'b', status: 'done', startOffsetMs: 0, durationMs: 7000 }),
      row({ id: 'r3', agentId: 'c', status: 'done', startOffsetMs: 0, durationMs: 6900 }),
    ];
    const run = buildMultiAgentRun(parent, rows);
    expect(run.total_duration_ms).toBe(8000);
    expect(run.comparison.wall_clock_ms).toBe(8000);
    expect(run.comparison.sequential_sum_ms).toBe(21900);
  });

  it('wall-clock includes time spent queued for a pool slot', () => {
    const rows = [
      row({ id: 'r1', agentId: 'a', status: 'done', startOffsetMs: 0, durationMs: 5000 }),
      row({ id: 'r4', agentId: 'd', status: 'done', startOffsetMs: 5000, durationMs: 4000 }), // started after a slot freed
    ];
    expect(wallClockMs(parent, rows)).toBe(9000);
  });

  it('wall-clock is null until a run has finished', () => {
    expect(wallClockMs(parent, [row({ id: 'r1', agentId: 'a', status: 'running' })])).toBeNull();
  });

  it('status badge per column and derived run status follow the runs', () => {
    const run = buildMultiAgentRun(parent, [
      row({ id: 'r1', agentId: 'a', status: 'queued' }),
      row({ id: 'r2', agentId: 'b', status: 'running' }),
      row({ id: 'r3', agentId: 'c', status: 'done', durationMs: 1 }),
    ]);
    expect(run.columns.map((c) => c.status)).toEqual(['queued', 'running', 'done']);
    expect(run.status).toBe('running');
    expect(buildMultiAgentRun(parent, [row({ id: 'r', agentId: 'a', status: 'failed', durationMs: 1 })]).status).toBe('failed');
  });

  it('1 vs N: reports measured totals, the baseline when present, and the shared intent call beside them', () => {
    const baseline = {
      run: { id: 'single', agentId: 'a', tokensIn: 1000, tokensOut: 100, costUsd: 0.03, durationMs: 6000 },
      agentName: 'Agent a',
    } as unknown as SingleAgentBaselineRow;
    const run = buildMultiAgentRun(
      parent,
      [
        row({ id: 'r1', agentId: 'a', status: 'done', durationMs: 6000, tokensIn: 900, tokensOut: 90, costUsd: 0.03 }),
        row({ id: 'r2', agentId: 'b', status: 'done', durationMs: 7000, tokensIn: 950, tokensOut: 200, costUsd: 0.04 }),
      ],
      { baseline, sharedIntent: { tokens_in: 300, tokens_out: 30, cost_usd: 0.001, cached: false } },
    );
    expect(run.comparison).toMatchObject({
      agents_total: 2,
      agents_done: 2,
      tokens_in: 1850,
      tokens_out: 290,
      baseline: { run_id: 'single', tokens_in: 1000, cost_usd: 0.03, duration_ms: 6000 },
      shared_intent: { tokens_in: 300, cost_usd: 0.001, cached: false },
    });
    // the intent cost is reported separately, never folded into the per-agent total
    expect(run.comparison.cost_usd).toBeCloseTo(0.07, 10);
  });

  it('1 vs N: no baseline -> null (the UI says "no baseline"); nothing assumes an N-times ratio', () => {
    const run = buildMultiAgentRun(parent, [row({ id: 'r1', agentId: 'a', status: 'done', durationMs: 1 })]);
    expect(run.comparison.baseline).toBeNull();
    expect(Object.keys(run.comparison)).not.toContain('ratio');
  });

  it('carries only ids, counts, severities, titles and rationales — no raw prompt/tool/diff fields (AC-56, AC-58)', () => {
    const run = buildMultiAgentRun(parent, [
      row({ id: 'r1', agentId: 'a', status: 'done', durationMs: 1, findings: [{ id: 'f', title: 'T', line: 1 }] }),
    ]);
    const json = JSON.stringify(run);
    for (const banned of ['raw_output', 'prompt_assembly', 'tool_calls', 'patch', 'diff']) {
      expect(json).not.toContain(banned);
    }
  });
});
