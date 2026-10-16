import { randomUUID } from 'node:crypto';
import type {
  EvalBatchDetail,
  EvalBatchList,
  EvalBatchSummary,
  EvalCompare,
  EvalCompareCase,
  EvalConfigSnapshot,
  EvalOverview,
} from '@devdigest/shared';
import type { CaseScore } from '../../domain/scoring.js';
import { executeCase } from '../run-case.js';
import { buildBatchDetail, groupRows, parseExpectation } from '../batch-summary.js';
import { EvalError } from '../errors.js';
import type {
  AgentConfigPort,
  AgentInfo,
  AgentRunnerPort,
  EvalLogPort,
  EvalStorePort,
  NewRun,
  StoredCase,
} from '../ports/eval-ports.js';

/** AC-19: at most this many model calls of a batch run at once. */
export const BATCH_CONCURRENCY = 2;
const HISTORY_LIMIT = 50;
const TREND_POINTS = 8;
const RECENT_LIMIT = 20;

export interface BatchDeps {
  store: EvalStorePort;
  agents: AgentConfigPort;
  runner: AgentRunnerPort;
  log?: EvalLogPort;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Case-level metrics stored on the row (the batch aggregate is recomputed from counts). */
function caseMetrics(score: CaseScore) {
  return {
    recall: score.kind === 'must_find' && !score.errored ? (score.pass ? 1 : 0) : null,
    precision: score.errored || score.kept === 0 ? null : (score.kept - score.noise) / score.kept,
    citationAccuracy: score.errored || score.emitted === 0 ? null : score.kept / score.emitted,
  };
}

/** AC-13..AC-21: run the agent once per case with fixed inputs; store one batch. */
export function createRunBatch({ store, agents, runner, log }: BatchDeps) {
  return async (workspaceId: string, agentId: string): Promise<EvalBatchDetail> => {
    const agent = await agents.getAgent(workspaceId, agentId);
    if (!agent) throw new EvalError('not_found', 'Agent not found');

    const cases = (await store.listCases(workspaceId, agentId)).flatMap((c) => {
      const expectation = parseExpectation(c.expectation);
      if (!expectation) {
        log?.warn('eval: skipped case with invalid expected_output', { caseId: c.id });
        return [];
      }
      return [{ stored: c, expectation }];
    });
    if (cases.length === 0) throw new EvalError('no_eval_cases', 'This agent has no eval cases yet');

    const batchId = randomUUID();
    const runOne = async ({ stored, expectation }: { stored: StoredCase; expectation: (typeof cases)[number]['expectation'] }): Promise<NewRun> => {
      const started = Date.now();
      const { score, output, costUsd } = await executeCase(runner, agent, stored.inputDiff, expectation, log);
      return {
        caseId: stored.id,
        batchId,
        pass: score.pass,
        actualOutput: output,
        ...caseMetrics(score),
        durationMs: Date.now() - started,
        costUsd,
        agentVersion: agent.version,
        provider: agent.provider,
        model: agent.model,
      };
    };

    const runs = await mapPool(cases, BATCH_CONCURRENCY, runOne);
    await store.insertRuns(runs);

    const rows = await store.rowsForBatches(workspaceId, [batchId]);
    const detail = buildBatchDetail(rows, agent.name, log);
    if (!detail) throw new EvalError('not_found', 'Batch could not be read back');
    return detail;
  };
}

async function agentNames(agents: AgentConfigPort, workspaceId: string): Promise<Map<string, AgentInfo>> {
  return new Map((await agents.listAgents(workspaceId)).map((a) => [a.id, a]));
}

async function summaries(
  deps: BatchDeps,
  workspaceId: string,
  agentId: string | undefined,
  limit: number,
): Promise<EvalBatchSummary[]> {
  const refs = await deps.store.listBatchRefs(workspaceId, agentId, limit);
  if (refs.length === 0) return [];
  const ids = refs.map((r) => r.batchId);
  const grouped = groupRows(await deps.store.rowsForBatches(workspaceId, ids), ids);
  const names = await agentNames(deps.agents, workspaceId);
  const out: EvalBatchSummary[] = [];
  for (const ref of refs) {
    const detail = buildBatchDetail(grouped.get(ref.batchId) ?? [], names.get(ref.agentId)?.name ?? 'Deleted agent', deps.log);
    if (detail) out.push(detail.summary);
  }
  return out;
}

/** AC-34: history of an agent, newest first. */
export function createListBatches(deps: BatchDeps) {
  return async (workspaceId: string, agentId: string): Promise<EvalBatchList> => {
    if (!(await deps.agents.getAgent(workspaceId, agentId))) throw new EvalError('not_found', 'Agent not found');
    return { batches: await summaries(deps, workspaceId, agentId, HISTORY_LIMIT) };
  };
}

export function createGetBatch(deps: BatchDeps) {
  return async (workspaceId: string, batchId: string): Promise<EvalBatchDetail> => {
    const rows = await deps.store.rowsForBatches(workspaceId, [batchId]);
    const first = rows[0];
    if (!first) throw new EvalError('not_found', 'Eval run not found');
    const names = await agentNames(deps.agents, workspaceId);
    const detail = buildBatchDetail(rows, names.get(first.agentId)?.name ?? 'Deleted agent', deps.log);
    if (!detail) throw new EvalError('not_found', 'Eval run not found');
    return detail;
  };
}

function delta(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : b - a;
}

/** AC-35: metric deltas, per-case changes and the config of both versions. */
export function createCompare(deps: BatchDeps) {
  const getBatch = createGetBatch(deps);
  const snapshot = async (agentId: string, s: EvalBatchSummary): Promise<EvalConfigSnapshot> => {
    const cfg = s.agent_version !== null ? await deps.agents.getVersionConfig(agentId, s.agent_version) : undefined;
    return {
      agent_version: s.agent_version,
      provider: cfg?.provider ?? s.provider,
      model: cfg?.model ?? s.model,
      system_prompt: cfg?.systemPrompt ?? null,
    };
  };
  return async (workspaceId: string, aId: string, bId: string): Promise<EvalCompare> => {
    const [a, b] = await Promise.all([getBatch(workspaceId, aId), getBatch(workspaceId, bId)]);
    if (a.summary.agent_id !== b.summary.agent_id) {
      throw new EvalError('batches_mismatch', 'Only runs of the same agent can be compared');
    }
    const byCase = new Map<string, EvalCompareCase>();
    for (const r of a.results) byCase.set(r.case_id, { case_id: r.case_id, case_name: r.case_name, kind: r.expectation.kind, a: r.pass, b: null });
    for (const r of b.results) {
      const cur = byCase.get(r.case_id);
      if (cur) cur.b = r.pass;
      else byCase.set(r.case_id, { case_id: r.case_id, case_name: r.case_name, kind: r.expectation.kind, a: null, b: r.pass });
    }
    const [configA, configB] = await Promise.all([
      snapshot(a.summary.agent_id, a.summary),
      snapshot(a.summary.agent_id, b.summary),
    ]);
    return {
      a: a.summary,
      b: b.summary,
      delta: {
        recall: delta(a.summary.recall, b.summary.recall),
        precision: delta(a.summary.precision, b.summary.precision),
        citation_accuracy: delta(a.summary.citation_accuracy, b.summary.citation_accuracy),
        cost_usd: delta(a.summary.cost_usd, b.summary.cost_usd),
      },
      config_a: configA,
      config_b: configB,
      cases: [...byCase.values()],
    };
  };
}

/** AC-38: the Eval Dashboard — latest batch + trend per agent, recent batches of all agents. */
export function createOverview(deps: BatchDeps) {
  return async (workspaceId: string): Promise<EvalOverview> => {
    const [agentList, counts, recent] = await Promise.all([
      deps.agents.listAgents(workspaceId),
      deps.store.countCasesByAgent(workspaceId),
      summaries(deps, workspaceId, undefined, RECENT_LIMIT),
    ]);
    const agents = await Promise.all(
      agentList.map(async (agent) => {
        const history = await summaries(deps, workspaceId, agent.id, TREND_POINTS);
        return {
          agent_id: agent.id,
          agent_name: agent.name,
          provider: agent.provider,
          model: agent.model,
          cases_total: counts.get(agent.id) ?? 0,
          latest: history[0] ?? null,
          trend: [...history].reverse().map((h) => ({
            ran_at: h.ran_at,
            recall: h.recall,
            precision: h.precision,
            citation_accuracy: h.citation_accuracy,
          })),
        };
      }),
    );
    return { agents, recent };
  };
}
