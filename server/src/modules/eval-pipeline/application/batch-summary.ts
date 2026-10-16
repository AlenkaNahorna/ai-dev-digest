import {
  EvalActualOutput,
  EvalExpectation,
  type EvalBatchCaseResult,
  type EvalBatchDetail,
  type EvalBatchSummary,
} from '@devdigest/shared';
import { aggregate, type CaseScore } from '../domain/scoring.js';
import type { BatchRow, EvalLogPort } from './ports/eval-ports.js';

/** Parse `expected_output`; `undefined` → the row is skipped with a warning (AC-42). */
export function parseExpectation(raw: unknown): EvalExpectation | undefined {
  const parsed = EvalExpectation.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

function parseOutput(raw: unknown): EvalActualOutput {
  const parsed = EvalActualOutput.safeParse(raw);
  if (parsed.success) return parsed.data;
  return { emitted: 0, kept: 0, dropped: 0, hits: 0, noise: 0, findings: [], error: 'unreadable output' };
}

/** Build the detail of ONE batch from its stored rows (rows of one batch_id). */
export function buildBatchDetail(
  rows: BatchRow[],
  agentName: string,
  log?: EvalLogPort,
): EvalBatchDetail | undefined {
  if (rows.length === 0) return undefined;
  const results: EvalBatchCaseResult[] = [];
  const scores: CaseScore[] = [];
  for (const row of rows) {
    const expectation = parseExpectation(row.expectation);
    if (!expectation) {
      log?.warn('eval: skipped run row with invalid expectation', { runId: row.id, caseId: row.caseId });
      continue;
    }
    const output = parseOutput(row.actualOutput);
    results.push({
      run_id: row.id,
      case_id: row.caseId,
      case_name: row.caseName,
      expectation,
      pass: row.pass === true,
      output,
      duration_ms: row.durationMs,
      cost_usd: row.costUsd,
    });
    scores.push({
      kind: expectation.kind,
      pass: row.pass === true,
      errored: !!output.error,
      emitted: output.emitted,
      kept: output.kept,
      dropped: output.dropped,
      hits: output.hits,
      noise: output.noise,
    });
  }
  if (results.length === 0) return undefined;
  const first = rows[0]!;
  const costs = rows.map((r) => r.costUsd).filter((c): c is number => c !== null);
  const summary: EvalBatchSummary = {
    batch_id: first.batchId ?? '',
    agent_id: first.agentId,
    agent_name: agentName,
    ran_at: new Date(Math.min(...rows.map((r) => r.ranAt.getTime()))).toISOString(),
    agent_version: first.agentVersion,
    provider: first.provider,
    model: first.model,
    cases_total: results.length,
    cases_passed: results.filter((r) => r.pass).length,
    errors: scores.filter((s) => s.errored).length,
    duration_ms: rows.reduce((n, r) => n + (r.durationMs ?? 0), 0),
    cost_usd: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null,
    ...aggregate(scores),
  };
  return { summary, results };
}

/** Group rows by batch id keeping the order of `batchIds`. */
export function groupRows(rows: BatchRow[], batchIds: string[]): Map<string, BatchRow[]> {
  const out = new Map<string, BatchRow[]>(batchIds.map((id) => [id, []]));
  for (const row of rows) if (row.batchId) out.get(row.batchId)?.push(row);
  return out;
}
