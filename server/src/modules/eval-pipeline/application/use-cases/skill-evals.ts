import { randomUUID } from 'node:crypto';
import type {
  EvalActualOutput,
  EvalVariantResult,
  EvalTryInput,
  EvalTryResult,
  SkillEvalCaseInput,
  SkillEvalCaseList,
  SkillEvalCaseRecord,
  SkillPairResult,
  SkillRunSummary,
} from '@devdigest/shared';
import { parseExpectation } from '../batch-summary.js';
import { EvalError } from '../errors.js';
import type { CaseScore } from '../../domain/scoring.js';
import { executeCase } from '../run-case.js';
import type {
  AgentInfo,
  AgentRunnerPort,
  EvalLogPort,
  EvalStorePort,
  NewRun,
  SkillConfigPort,
  SkillInfo,
  StoredCase,
  StoredRun,
} from '../ports/eval-ports.js';

export interface SkillEvalDeps {
  store: EvalStorePort;
  skills: SkillConfigPort;
  runner: AgentRunnerPort;
  log?: EvalLogPort;
}

/** Same cap as the agent batch (AC-19): at most this many model calls at once. */
const SKILL_CONCURRENCY = 2;

const skillPrompt = (skill: SkillInfo): string => `### ${skill.name} · v${skill.version}\n\n${skill.body}`;

function summaryOf(run: StoredRun | undefined): EvalVariantResult | null {
  if (!run) return null;
  const o = (run.actualOutput ?? null) as Partial<EvalActualOutput> | null;
  const summary =
    o && typeof o.emitted === 'number'
      ? { emitted: o.emitted, kept: o.kept ?? 0, hits: o.hits ?? 0, noise: o.noise ?? 0, error: typeof o.error === 'string' ? o.error : null }
      : null;
  return { pass: run.pass === true, summary };
}

function toRecord(
  c: StoredCase,
  runs: { withSkill?: StoredRun; withoutSkill?: StoredRun } | undefined,
  log?: EvalLogPort,
): SkillEvalCaseRecord | undefined {
  const expectation = parseExpectation(c.expectation);
  if (!expectation) {
    log?.warn('eval: skipped skill case with invalid expected_output', { caseId: c.id });
    return undefined;
  }
  const w = runs?.withSkill;
  const wo = runs?.withoutSkill;
  const ranAt = [w?.ranAt, wo?.ranAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
  return {
    id: c.id,
    skill_id: c.agentId,
    name: c.name,
    expectation,
    input_diff: c.inputDiff,
    created_at: c.createdAt ? c.createdAt.toISOString() : null,
    latest: ranAt ? { ran_at: ranAt.toISOString(), with_skill: summaryOf(w), without_skill: summaryOf(wo) } : null,
  };
}

async function context(deps: SkillEvalDeps, workspaceId: string, skillId: string): Promise<{ skill: SkillInfo; agent: AgentInfo }> {
  const skill = await deps.skills.getSkill(workspaceId, skillId);
  if (!skill) throw new EvalError('not_found', 'Skill not found');
  const agent = await deps.skills.linkedAgent(workspaceId, skillId);
  if (!agent) throw new EvalError('skill_not_linked', 'Link this skill to an enabled agent first — its evals run on that agent');
  return { skill, agent };
}

/** One case, both sides: the agent with ONLY this skill vs the same agent with no skills. */
async function runPair(
  deps: SkillEvalDeps,
  skill: SkillInfo,
  agent: AgentInfo,
  diff: string,
  expectation: NonNullable<ReturnType<typeof parseExpectation>>,
) {
  const [w, wo] = await Promise.all([
    executeCase(deps.runner, agent, diff, expectation, deps.log, { skills: [skillPrompt(skill)] }),
    executeCase(deps.runner, agent, diff, expectation, deps.log, { skills: [] }),
  ]);
  return { w, wo };
}

const asTry = (e: { score: CaseScore; output: EvalActualOutput; costUsd: number | null }, agent: AgentInfo, ms: number): EvalTryResult => ({
  pass: e.score.pass,
  output: e.output,
  duration_ms: ms,
  cost_usd: e.costUsd,
  agent_version: agent.version,
  provider: agent.provider,
  model: agent.model,
});

function runRow(caseId: string, batchId: string, agent: AgentInfo, e: { score: CaseScore; output: EvalActualOutput; costUsd: number | null }, variant: 'with_skill' | 'without_skill', ms: number): NewRun {
  const s = e.score;
  return {
    caseId,
    batchId,
    pass: s.pass,
    actualOutput: { ...e.output, variant },
    recall: s.kind === 'must_find' && !s.errored ? (s.pass ? 1 : 0) : null,
    precision: s.errored || s.kept === 0 ? null : (s.kept - s.noise) / s.kept,
    citationAccuracy: s.errored || s.emitted === 0 ? null : s.kept / s.emitted,
    durationMs: ms,
    costUsd: e.costUsd,
    agentVersion: agent.version,
    provider: agent.provider,
    model: agent.model,
  };
}

/** "New eval case" on a skill: written by hand — there is no finding to seed it from. */
export function createSkillCase({ store, skills, log }: Pick<SkillEvalDeps, 'store' | 'skills' | 'log'>) {
  return async (workspaceId: string, skillId: string, input: SkillEvalCaseInput): Promise<SkillEvalCaseRecord> => {
    if (!(await skills.getSkill(workspaceId, skillId))) throw new EvalError('not_found', 'Skill not found');
    const stored = await store.insertSkillCase(workspaceId, {
      skillId,
      name: input.name,
      inputDiff: input.input_diff,
      expectation: input.expectation,
    });
    const record = toRecord(stored, undefined, log);
    if (!record) throw new EvalError('not_found', 'The case could not be stored');
    return record;
  };
}

export function createListSkillCases({ store, skills, log }: Pick<SkillEvalDeps, 'store' | 'skills' | 'log'>) {
  return async (workspaceId: string, skillId: string): Promise<SkillEvalCaseList> => {
    if (!(await skills.getSkill(workspaceId, skillId))) throw new EvalError('not_found', 'Skill not found');
    const [cases, runs] = await Promise.all([store.listSkillCases(workspaceId, skillId), store.latestSkillRuns(workspaceId, skillId)]);
    const records = cases.map((c) => toRecord(c, runs.get(c.id), log)).filter((r): r is SkillEvalCaseRecord => r !== undefined);
    const withRuns = records.filter((r) => r.latest !== null);
    return { cases: records, passing: withRuns.filter((r) => r.latest?.with_skill?.pass).length, with_runs: withRuns.length };
  };
}

/** "Run case" in the modal: a trial of a draft, both sides, nothing stored. */
export function createTrySkillCase(deps: SkillEvalDeps) {
  return async (workspaceId: string, skillId: string, input: EvalTryInput): Promise<SkillPairResult> => {
    const { skill, agent } = await context(deps, workspaceId, skillId);
    const started = Date.now();
    const { w, wo } = await runPair(deps, skill, agent, input.input_diff, input.expectation);
    const ms = Date.now() - started;
    return {
      agent_id: agent.id,
      agent_name: agent.name,
      provider: agent.provider,
      model: agent.model,
      with_skill: asTry(w, agent, ms),
      without_skill: asTry(wo, agent, ms),
    };
  };
}

/** "Run" on one row: both sides of that stored case become its latest result. */
export function createRunSkillCase(deps: SkillEvalDeps) {
  return async (workspaceId: string, skillId: string, caseId: string): Promise<SkillPairResult> => {
    const stored = await deps.store.getCase(workspaceId, caseId);
    if (!stored || stored.ownerKind !== 'skill' || stored.agentId !== skillId) throw new EvalError('not_found', 'Eval case not found');
    const expectation = parseExpectation(stored.expectation);
    if (!expectation) throw new EvalError('not_found', 'Eval case has an invalid expected output');
    const { skill, agent } = await context(deps, workspaceId, skillId);
    const started = Date.now();
    const { w, wo } = await runPair(deps, skill, agent, stored.inputDiff, expectation);
    const ms = Date.now() - started;
    const batchId = randomUUID();
    await deps.store.insertRuns([runRow(stored.id, batchId, agent, w, 'with_skill', ms), runRow(stored.id, batchId, agent, wo, 'without_skill', ms)]);
    return {
      agent_id: agent.id,
      agent_name: agent.name,
      provider: agent.provider,
      model: agent.model,
      with_skill: asTry(w, agent, ms),
      without_skill: asTry(wo, agent, ms),
    };
  };
}

/** "Run all evals" on a skill: every case, both sides, stored as each case's latest result. */
export function createRunSkillEvals(deps: SkillEvalDeps) {
  return async (workspaceId: string, skillId: string): Promise<SkillRunSummary> => {
    const { skill, agent } = await context(deps, workspaceId, skillId);
    const cases = (await deps.store.listSkillCases(workspaceId, skillId)).flatMap((c) => {
      const expectation = parseExpectation(c.expectation);
      return expectation ? [{ stored: c, expectation }] : [];
    });
    if (cases.length === 0) throw new EvalError('no_eval_cases', 'This skill has no eval cases yet');

    const batchId = randomUUID();
    const results: SkillRunSummary['results'] = new Array(cases.length);
    const rows: NewRun[] = [];
    let next = 0;
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= cases.length) return;
        const { stored, expectation } = cases[i]!;
        const started = Date.now();
        const { w, wo } = await runPair(deps, skill, agent, stored.inputDiff, expectation);
        const ms = Date.now() - started;
        results[i] = { case_id: stored.id, with_skill: asTry(w, agent, ms), without_skill: asTry(wo, agent, ms) };
        rows.push(runRow(stored.id, batchId, agent, w, 'with_skill', ms), runRow(stored.id, batchId, agent, wo, 'without_skill', ms));
      }
    };
    // Each case makes two model calls at once, so one worker keeps the total at the shared cap of 2.
    await Promise.all(Array.from({ length: Math.max(1, SKILL_CONCURRENCY / 2) }, worker));
    await deps.store.insertRuns(rows);
    return {
      agent_id: agent.id,
      agent_name: agent.name,
      provider: agent.provider,
      model: agent.model,
      total: results.length,
      passing_with_skill: results.filter((r) => r.with_skill.pass).length,
      passing_without_skill: results.filter((r) => r.without_skill.pass).length,
      results,
    };
  };
}
