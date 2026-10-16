import { EvalActualOutput as EvalActualOutputSchema } from '@devdigest/shared';
import type {
  EvalCaseDraft,
  EvalCaseList,
  EvalCaseOverrides,
  EvalCaseRecord,
  EvalExpectation,
  EvalImportResult,
  EvalTryInput,
  EvalTryResult,
  SkillEvalCaseInput,
} from '@devdigest/shared';
import { uniqueCaseName } from '../../domain/case-name.js';
import { extractFileFragment } from '../../domain/fragment.js';
import { parseExpectation } from '../batch-summary.js';
import { EvalError } from '../errors.js';
import { executeCase } from '../run-case.js';
import type {
  AgentConfigPort,
  AgentInfo,
  AgentRunnerPort,
  EvalLogPort,
  EvalStorePort,
  FindingSourcePort,
  SourceFinding,
  StoredCase,
  StoredRun,
} from '../ports/eval-ports.js';

export interface CaseDeps {
  store: EvalStorePort;
  findings: FindingSourcePort;
  agents: AgentConfigPort;
  log?: EvalLogPort;
}

function summaryOf(raw: unknown): NonNullable<EvalCaseRecord['latest']>['summary'] {
  const o = EvalActualOutputSchema.safeParse(raw);
  if (!o.success) return null;
  const { emitted, kept, hits, noise, error } = o.data;
  return { emitted, kept, hits, noise, error: error ?? null };
}

function toRecord(c: StoredCase, latest: StoredRun | undefined, log?: EvalLogPort): EvalCaseRecord | undefined {
  const expectation = parseExpectation(c.expectation);
  if (!expectation) {
    log?.warn('eval: skipped case with invalid expected_output', { caseId: c.id });
    return undefined;
  }
  return {
    id: c.id,
    agent_id: c.agentId,
    name: c.name,
    expectation,
    input_diff: c.inputDiff,
    source_finding_id: c.sourceFindingId,
    source_pr_id: c.sourcePrId,
    created_at: c.createdAt ? c.createdAt.toISOString() : null,
    latest: latest
      ? { pass: latest.pass === true, ran_at: latest.ranAt.toISOString(), batch_id: latest.batchId, summary: summaryOf(latest.actualOutput) }
      : null,
  };
}

interface Prepared {
  agent: AgentInfo;
  name: string;
  fragment: string;
  expectation: EvalExpectation;
}

/** AC-1..AC-9: one case from one decided finding. No model call. */
export function createCaseFromFinding({ store, findings, agents, log }: CaseDeps) {
  /** Validate the finding and build the seeded case — shared by the modal draft and the save. */
  const prepare = async (workspaceId: string, finding: SourceFinding): Promise<Prepared> => {
    if (finding.decision === null) {
      throw new EvalError('finding_undecided', 'Accept or dismiss the finding before turning it into an eval case');
    }
    if (!finding.agentId) {
      throw new EvalError('finding_without_agent', 'The finding has no producing agent');
    }
    const agent = await agents.getAgent(workspaceId, finding.agentId);
    if (!agent) throw new EvalError('not_found', 'Agent not found');
    if (await store.findCaseBySource(workspaceId, agent.id, finding.id)) {
      throw new EvalError('eval_case_exists', 'This finding is already an eval case');
    }
    const raw = await findings.loadPrDiff(workspaceId, finding.prId).catch(() => undefined);
    const fragment = raw ? extractFileFragment(raw, finding.file, finding.startLine, finding.endLine) : undefined;
    if (!fragment) throw new EvalError('diff_unavailable', 'The diff of this finding is not available');

    const taken = new Set((await store.listCases(workspaceId, agent.id)).map((c) => c.name));
    return {
      agent,
      fragment,
      name: uniqueCaseName(finding.title, finding.startLine, taken),
      expectation: {
        kind: finding.decision === 'accepted' ? 'must_find' : 'must_not_flag',
        file: finding.file,
        start_line: finding.startLine,
        end_line: finding.endLine,
        title: finding.title,
        severity: finding.severity as EvalExpectation['severity'],
        category: finding.category as EvalExpectation['category'],
      },
    };
  };

  const create = async (
    workspaceId: string,
    finding: SourceFinding,
    overrides?: EvalCaseOverrides,
  ): Promise<EvalCaseRecord> => {
    const p = await prepare(workspaceId, finding);
    const stored = await store.insertCase(workspaceId, {
      agentId: p.agent.id,
      name: overrides?.name ?? p.name,
      inputDiff: overrides?.input_diff ?? p.fragment,
      expectation: overrides?.expectation ?? p.expectation,
      sourceFindingId: finding.id,
      sourcePrId: finding.prId,
    });
    if (stored === 'duplicate') throw new EvalError('eval_case_exists', 'This finding is already an eval case');
    const record = toRecord(stored, undefined, log);
    if (!record) throw new EvalError('diff_unavailable', 'The finding could not be stored as a valid case');
    return record;
  };

  const load = async (workspaceId: string, findingId: string): Promise<SourceFinding> => {
    const finding = await findings.getFinding(workspaceId, findingId);
    if (!finding) throw new EvalError('not_found', 'Finding not found');
    return finding;
  };

  return {
    create,
    async fromFindingId(
      workspaceId: string,
      findingId: string,
      overrides?: EvalCaseOverrides,
    ): Promise<EvalCaseRecord> {
      return create(workspaceId, await load(workspaceId, findingId), overrides);
    },
    /** What the "New eval case" modal opens with. Stores nothing, calls no model. */
    async draftFromFindingId(workspaceId: string, findingId: string): Promise<EvalCaseDraft> {
      const finding = await load(workspaceId, findingId);
      const p = await prepare(workspaceId, finding);
      return {
        agent_id: p.agent.id,
        agent_name: p.agent.name,
        provider: p.agent.provider,
        model: p.agent.model,
        name: p.name,
        expectation: p.expectation,
        input_diff: p.fragment,
        source_finding_id: finding.id,
        source_pr_id: finding.prId,
      };
    },
  };
}

/**
 * "Run case" in the modal: run the agent once on a draft and score it in code.
 * Nothing is stored — the case does not exist yet and history stays clean.
 */
export function createTryCase(deps: { agents: AgentConfigPort; runner: AgentRunnerPort; log?: EvalLogPort }) {
  return async (workspaceId: string, agentId: string, input: EvalTryInput): Promise<EvalTryResult> => {
    const agent = await deps.agents.getAgent(workspaceId, agentId);
    if (!agent) throw new EvalError('not_found', 'Agent not found');
    const started = Date.now();
    const { score, output, costUsd } = await executeCase(deps.runner, agent, input.input_diff, input.expectation, deps.log);
    return {
      pass: score.pass,
      output,
      duration_ms: Date.now() - started,
      cost_usd: costUsd,
      agent_version: agent.version,
      provider: agent.provider,
      model: agent.model,
    };
  };
}

/** AC-10 / AC-11. */
/** "New eval case" on the agent page: written by hand, no finding to seed it from. */
export function createManualCase({ store, agents, log }: Pick<CaseDeps, 'store' | 'agents' | 'log'>) {
  return async (workspaceId: string, agentId: string, input: SkillEvalCaseInput): Promise<EvalCaseRecord> => {
    if (!(await agents.getAgent(workspaceId, agentId))) throw new EvalError('not_found', 'Agent not found');
    const stored = await store.insertManualCase(workspaceId, {
      agentId,
      name: input.name,
      inputDiff: input.input_diff,
      expectation: input.expectation,
    });
    const record = toRecord(stored, undefined, log);
    if (!record) throw new EvalError('not_found', 'The case could not be stored');
    return record;
  };
}

export function createListCases({ store, agents, log }: CaseDeps) {
  return async (workspaceId: string, agentId: string): Promise<EvalCaseList> => {
    if (!(await agents.getAgent(workspaceId, agentId))) throw new EvalError('not_found', 'Agent not found');
    const [cases, latest] = await Promise.all([
      store.listCases(workspaceId, agentId),
      store.latestRunByCase(workspaceId, agentId),
    ]);
    const records = cases
      .map((c) => toRecord(c, latest.get(c.id), log))
      .filter((r): r is EvalCaseRecord => r !== undefined);
    const withRuns = records.filter((r) => r.latest !== null);
    return {
      cases: records,
      passing: withRuns.filter((r) => r.latest?.pass).length,
      with_runs: withRuns.length,
    };
  };
}

/** AC-12. */
export function createDeleteCase({ store }: Pick<CaseDeps, 'store'>) {
  return async (workspaceId: string, caseId: string): Promise<void> => {
    if (!(await store.deleteCase(workspaceId, caseId))) throw new EvalError('not_found', 'Eval case not found');
  };
}

/** AC-45 (P2): create a case for every decided finding of the agent that has none yet. */
export function createImportFromDecisions(deps: CaseDeps) {
  const creator = createCaseFromFinding(deps);
  return async (workspaceId: string, agentId: string): Promise<EvalImportResult> => {
    if (!(await deps.agents.getAgent(workspaceId, agentId))) throw new EvalError('not_found', 'Agent not found');
    const decided = await deps.findings.listDecided(workspaceId, agentId);
    const result: EvalImportResult = { created: 0, skipped: 0, failed: 0 };
    for (const finding of decided) {
      try {
        await creator.create(workspaceId, finding);
        result.created += 1;
      } catch (err) {
        if (err instanceof EvalError && err.kind === 'eval_case_exists') result.skipped += 1;
        else result.failed += 1;
      }
    }
    return result;
  };
}

/** "Edit" on a case row: change name, diff or expectation of a stored case. */
export function createUpdateCase({ store, log }: Pick<CaseDeps, 'store' | 'log'>) {
  return async (workspaceId: string, caseId: string, overrides: EvalCaseOverrides): Promise<EvalCaseRecord> => {
    const updated = await store.updateCase(workspaceId, caseId, {
      name: overrides.name,
      inputDiff: overrides.input_diff,
      expectation: overrides.expectation,
    });
    if (!updated) throw new EvalError('not_found', 'Eval case not found');
    const latest = (await store.latestRunByCase(workspaceId, updated.agentId)).get(updated.id);
    const record = toRecord(updated, latest, log);
    if (!record) throw new EvalError('not_found', 'Eval case not found');
    return record;
  };
}

/**
 * "Run" on one case row: run the agent on the stored case and keep the result as the case's latest
 * result. The run has no batch id, so run history and the dashboard metrics are not affected.
 */
export function createRunStoredCase({ store, agents, runner, log }: Pick<CaseDeps, 'store' | 'agents' | 'log'> & { runner: AgentRunnerPort }) {
  return async (workspaceId: string, caseId: string): Promise<EvalTryResult> => {
    const stored = await store.getCase(workspaceId, caseId);
    if (!stored || stored.ownerKind !== 'agent') throw new EvalError('not_found', 'Eval case not found');
    const expectation = parseExpectation(stored.expectation);
    if (!expectation) throw new EvalError('not_found', 'Eval case has an invalid expected output');
    const agent = await agents.getAgent(workspaceId, stored.agentId);
    if (!agent) throw new EvalError('not_found', 'Agent not found');
    const started = Date.now();
    const { score, output, costUsd } = await executeCase(runner, agent, stored.inputDiff, expectation, log);
    const durationMs = Date.now() - started;
    await store.insertRuns([
      {
        caseId: stored.id,
        batchId: null,
        pass: score.pass,
        actualOutput: output,
        recall: score.kind === 'must_find' && !score.errored ? (score.pass ? 1 : 0) : null,
        precision: score.errored || score.kept === 0 ? null : (score.kept - score.noise) / score.kept,
        citationAccuracy: score.errored || score.emitted === 0 ? null : score.kept / score.emitted,
        durationMs,
        costUsd,
        agentVersion: agent.version,
        provider: agent.provider,
        model: agent.model,
      },
    ]);
    return { pass: score.pass, output, duration_ms: durationMs, cost_usd: costUsd, agent_version: agent.version, provider: agent.provider, model: agent.model };
  };
}
