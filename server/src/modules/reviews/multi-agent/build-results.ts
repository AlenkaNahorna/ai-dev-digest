import type {
  AgentColumn,
  AgentColumnFinding,
  AgentColumnFindingState,
  MultiAgentBaseline,
  MultiAgentComparison,
  MultiAgentRun,
  MultiAgentRunStatus,
  MultiAgentSharedIntent,
  Severity,
} from '@devdigest/shared';
import type {
  MultiAgentParentRow,
  MultiAgentRunRow,
  SingleAgentBaselineRow,
} from '../adapters/outbound/persistence/run.repo.js';
import { computeGroups, type GroupingFinding } from './grouping.js';
import { computeConflicts, type ConflictAgent } from './conflicts.js';

/**
 * Pure read-model: map the persisted parent + per-agent runs (with newest
 * review + findings) into the `MultiAgentRun` response. Status, totals, groups
 * and conflicts are all computed on read; nothing here writes (AC-18/20/39/48/
 * 49/52). No DB/Fastify imports.
 */

const SEVERITIES = new Set<string>(['CRITICAL', 'WARNING', 'SUGGESTION']);

function findingState(f: { acceptedAt: Date | null; dismissedAt: Date | null }): AgentColumnFindingState {
  if (f.acceptedAt) return 'accepted';
  if (f.dismissedAt) return 'dismissed';
  return 'open';
}

/** running | partial | failed | done, derived from the per-agent run statuses. */
function deriveStatus(statuses: (string | null)[]): MultiAgentRunStatus {
  const active = statuses.some((s) => s === 'running' || s === 'queued' || s === null);
  if (active) return 'running';
  const done = statuses.filter((s) => s === 'done').length;
  const failed = statuses.filter((s) => s === 'failed' || s === 'cancelled').length;
  if (done === 0 && failed > 0) return 'failed';
  if (failed > 0) return 'partial';
  return 'done';
}

/** Map a run's status string to the AgentColumn status enum. */
function columnStatus(status: string | null): AgentColumn['status'] {
  if (status === 'done') return 'done';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  if (status === 'queued') return 'queued';
  return 'running';
}

const TERMINAL = new Set(['done', 'failed', 'cancelled']);

/**
 * Real elapsed time of the review: from the parent's start to the moment the
 * last finished run ended (`ran_at` is reset to the true start when a queued run
 * begins, so queue time counts). Null until at least one run has finished. This
 * is deliberately NOT the sum of durations — with a pool of concurrent agents
 * that sum overstates the wall-clock (AC-50).
 */
export function wallClockMs(parent: MultiAgentParentRow, rows: MultiAgentRunRow[]): number | null {
  let end: number | null = null;
  for (const { run } of rows) {
    if (!TERMINAL.has(run.status ?? '') || run.durationMs == null) continue;
    const finishedAt = run.ranAt.getTime() + run.durationMs;
    if (end === null || finishedAt > end) end = finishedAt;
  }
  return end === null ? null : Math.max(0, Math.round(end - parent.ranAt.getTime()));
}

function toBaseline(row: SingleAgentBaselineRow | undefined): MultiAgentBaseline | null {
  if (!row) return null;
  return {
    run_id: row.run.id,
    agent_id: row.run.agentId ?? '',
    agent_name: row.agentName,
    tokens_in: row.run.tokensIn,
    tokens_out: row.run.tokensOut,
    cost_usd: row.run.costUsd,
    duration_ms: row.run.durationMs,
  };
}

/**
 * Measured "1 vs N" totals from the actual per-agent numbers (AC-48..52). Costs
 * that are unknown (null) are excluded from the sum and counted separately —
 * never treated as $0 of real work. No N-times ratio is assumed anywhere.
 */
export function buildComparison(
  parent: MultiAgentParentRow,
  rows: MultiAgentRunRow[],
  columns: AgentColumn[],
  baseline: SingleAgentBaselineRow | undefined,
  sharedIntent: MultiAgentSharedIntent | null,
): MultiAgentComparison {
  const finished = columns.filter((c) => c.status === 'done' || c.status === 'failed');
  const knownCosts = columns.map((c) => c.cost_usd).filter((c): c is number => c !== null);
  return {
    agents_total: columns.length,
    agents_done: columns.filter((c) => c.status === 'done').length,
    tokens_in: finished.reduce((acc, c) => acc + (c.tokens_in ?? 0), 0),
    tokens_out: finished.reduce((acc, c) => acc + (c.tokens_out ?? 0), 0),
    cost_usd: knownCosts.length > 0 ? knownCosts.reduce((a, b) => a + b, 0) : null,
    cost_unknown_agents: finished.filter((c) => c.cost_usd === null).length,
    wall_clock_ms: wallClockMs(parent, rows),
    sequential_sum_ms: columns.reduce((acc, c) => acc + (c.duration_ms ?? 0), 0),
    baseline: toBaseline(baseline),
    shared_intent: sharedIntent,
  };
}

export function buildMultiAgentRun(
  parent: MultiAgentParentRow,
  rows: MultiAgentRunRow[],
  extras: { baseline?: SingleAgentBaselineRow | undefined; sharedIntent?: MultiAgentSharedIntent | null } = {},
): MultiAgentRun {
  const columns: AgentColumn[] = rows.map(({ run, agentName, review, findings }) => {
    const colFindings: AgentColumnFinding[] = findings.map((f) => ({
      id: f.id,
      agent_id: run.agentId ?? '',
      severity: f.severity as Severity,
      category: f.category,
      title: f.title,
      file: f.file,
      start_line: f.startLine,
      end_line: f.endLine,
      rationale: f.rationale,
      suggestion: f.suggestion,
      confidence: f.confidence,
      state: findingState(f),
      kind: f.kind,
    }));
    return {
      run_id: run.id,
      agent_id: run.agentId ?? '',
      agent_name: agentName ?? 'Unknown agent',
      provider: run.provider,
      model: run.model,
      status: columnStatus(run.status),
      verdict: review?.verdict ?? null,
      score: review?.score ?? run.score ?? null,
      summary: review?.summary ?? null,
      duration_ms: run.durationMs,
      tokens_in: run.tokensIn,
      tokens_out: run.tokensOut,
      cost_usd: run.costUsd,
      findings: colFindings,
    };
  });

  // Total cost = sum of known per-run costs; null costs excluded. Null when no
  // run has a known cost at all (AC-49, AC-52).
  const knownCosts = columns.map((c) => c.cost_usd).filter((c): c is number => c !== null);
  const totalCost = knownCosts.length > 0 ? knownCosts.reduce((a, b) => a + b, 0) : null;
  const comparison = buildComparison(parent, rows, columns, extras.baseline, extras.sharedIntent ?? null);

  // Grouping over every finding of every DONE column (ungrouped findings form a
  // group of one id). Running/failed columns contribute no findings.
  const groupingInput: GroupingFinding[] = columns.flatMap((c) =>
    c.findings.map((f) => ({
      id: f.id,
      agentId: c.agent_id,
      file: f.file,
      startLine: f.start_line,
      endLine: f.end_line,
      category: f.category,
      title: f.title,
    })),
  );
  const groups = computeGroups(groupingInput);

  const conflictAgents: ConflictAgent[] = columns.map((c) => ({
    agentId: c.agent_id,
    agentName: c.agent_name,
    completed: c.status === 'done',
    findings: c.findings
      .filter((f) => SEVERITIES.has(f.severity))
      .map((f) => ({ file: f.file, line: f.start_line, title: f.title, severity: f.severity as Severity })),
  }));
  const conflicts = computeConflicts(conflictAgents);

  return {
    id: parent.id,
    pr_id: parent.prId,
    ...(parent.prNumber !== null ? { pr_number: parent.prNumber } : {}),
    ran_at: parent.ranAt.toISOString(),
    status: deriveStatus(columns.map((c) => c.status)),
    agent_count: columns.length,
    total_duration_ms: comparison.wall_clock_ms ?? 0,
    total_cost_usd: totalCost,
    comparison,
    columns,
    groups,
    conflicts,
  };
}
