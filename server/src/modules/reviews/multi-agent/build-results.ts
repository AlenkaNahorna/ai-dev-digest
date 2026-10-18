import type {
  AgentColumn,
  AgentColumnFinding,
  AgentColumnFindingState,
  MultiAgentRun,
  MultiAgentRunStatus,
  Severity,
} from '@devdigest/shared';
import type { MultiAgentParentRow, MultiAgentRunRow } from '../adapters/outbound/persistence/run.repo.js';
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

export function buildMultiAgentRun(parent: MultiAgentParentRow, rows: MultiAgentRunRow[]): MultiAgentRun {
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
  const totalDuration = columns.reduce((acc, c) => acc + (c.duration_ms ?? 0), 0);

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
    total_duration_ms: totalDuration,
    total_cost_usd: totalCost,
    columns,
    groups,
    conflicts,
  };
}
