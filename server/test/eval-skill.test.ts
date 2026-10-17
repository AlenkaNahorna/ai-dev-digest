import { describe, it, expect } from 'vitest';
import {
  createListSkillCases,
  createRunSkillCase,
  createRunSkillEvals,
  createSkillCase,
  createTrySkillCase,
} from '../src/modules/eval-pipeline/application/use-cases/skill-evals.js';
import { createDeleteCase, createUpdateCase } from '../src/modules/eval-pipeline/application/use-cases/cases.js';
import { EvalError } from '../src/modules/eval-pipeline/application/errors.js';
import { FakeSkills, MemoryStore, ScriptedRunner, SKILL_ID, WS, kept } from './helpers/eval-fakes.js';

const EXP = { kind: 'must_find' as const, file: 'api.ts', start_line: 10, end_line: 12, title: 'removed field', severity: 'CRITICAL' as const, category: 'security' as const };
const DIFF = '--- a/api.ts\n+++ b/api.ts\n@@ -10,3 +10,2 @@\n-  id: string;\n+  // gone\n';

/** The skill is what makes the agent notice the removal: with it the finding appears, without it not. */
const skillMakesTheDifference = () =>
  new ScriptedRunner((_a, _d, opts) => ({ kept: opts?.skills?.length ? [kept('api.ts', 11)] : [], droppedCount: 0, costUsd: 0.01 }));

function setup(runner = skillMakesTheDifference(), skills = new FakeSkills()) {
  const store = new MemoryStore();
  return { store, skills, runner, deps: { store, skills, runner } };
}
const kindOf = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof EvalError ? e.kind : 'other'));

describe('skill evals: cases', () => {
  it('stores a hand-written case for the skill and lists it as never run', async () => {
    const { deps, store } = setup();
    const rec = await createSkillCase(deps)(WS, SKILL_ID, { name: 'removal-is-flagged', expectation: EXP, input_diff: DIFF });
    expect(rec).toMatchObject({ skill_id: SKILL_ID, name: 'removal-is-flagged', latest: null });
    expect(store.cases[0]).toMatchObject({ ownerKind: 'skill', agentId: SKILL_ID });
    const list = await createListSkillCases(deps)(WS, SKILL_ID);
    expect(list).toMatchObject({ passing: 0, with_runs: 0 });
    expect(list.cases).toHaveLength(1);
  });
  it('404s for an unknown or foreign skill', async () => {
    const { deps } = setup();
    expect(await kindOf(createSkillCase(deps)(WS, 'nope', { name: 'x', expectation: EXP, input_diff: DIFF }))).toBe('not_found');
    expect(await kindOf(createListSkillCases(deps)('other-ws', SKILL_ID))).toBe('not_found');
  });
  it('edit and delete work for skill cases too', async () => {
    const { deps, store } = setup();
    const rec = await createSkillCase(deps)(WS, SKILL_ID, { name: 'a', expectation: EXP, input_diff: DIFF });
    const upd = await createUpdateCase({ store, log: undefined })(WS, rec.id, { name: 'renamed' });
    expect(upd.name).toBe('renamed');
    await createDeleteCase({ store })(WS, rec.id);
    expect(store.cases).toHaveLength(0);
  });
});

describe('skill evals: runs', () => {
  it('runs every case twice — only this skill vs no skills — and stores both sides', async () => {
    const { deps, runner, store } = setup();
    const rec = await createSkillCase(deps)(WS, SKILL_ID, { name: 'a', expectation: EXP, input_diff: DIFF });
    const out = await createRunSkillEvals(deps)(WS, SKILL_ID);
    expect(runner.calls).toHaveLength(2);
    const withSkill = runner.calls.find((c) => c.skills && c.skills.length > 0)!;
    expect(withSkill.skills).toHaveLength(1);
    expect(withSkill.skills![0]).toContain('breaking-change');
    expect(withSkill.skills![0]).toContain('Flag removed public fields.');
    expect(runner.calls.find((c) => c.skills?.length === 0)).toBeDefined();
    expect(runner.calls.every((c) => c.agent.id === 'agent-1' && c.diff === DIFF)).toBe(true);
    expect(out).toMatchObject({ total: 1, passing_with_skill: 1, passing_without_skill: 0, agent_name: 'Security Reviewer' });
    expect(store.runs.map((r) => (r.actualOutput as { variant: string }).variant).sort()).toEqual(['with_skill', 'without_skill']);
    const list = await createListSkillCases(deps)(WS, SKILL_ID);
    expect(list.passing).toBe(1);
    expect(list.cases[0]!.latest).toMatchObject({
      with_skill: { pass: true, summary: { kept: 1, hits: 1 } },
      without_skill: { pass: false, summary: { kept: 0 } },
    });
    expect(rec.id).toBe(list.cases[0]!.id);
  });
  it('refuses a skill that is not linked to an agent and calls no model', async () => {
    const unlinked = new FakeSkills();
    unlinked.linked = undefined;
    const { deps, runner } = setup(undefined, unlinked);
    await createSkillCase(deps)(WS, SKILL_ID, { name: 'a', expectation: EXP, input_diff: DIFF });
    expect(await kindOf(createRunSkillEvals(deps)(WS, SKILL_ID))).toBe('skill_not_linked');
    expect(runner.calls).toHaveLength(0);
  });
  it('refuses to run a skill without cases', async () => {
    const { deps, runner } = setup();
    expect(await kindOf(createRunSkillEvals(deps)(WS, SKILL_ID))).toBe('no_eval_cases');
    expect(runner.calls).toHaveLength(0);
  });
  it('"Run" on one row stores that case only; a case of another skill is not found', async () => {
    const skills = new FakeSkills([
      { id: SKILL_ID, name: 'breaking-change', version: 3, body: 'x' },
      { id: 'skill-2', name: 'other', version: 1, body: 'y' },
    ]);
    const { deps, store } = setup(undefined, skills);
    const a = await createSkillCase(deps)(WS, SKILL_ID, { name: 'a', expectation: EXP, input_diff: DIFF });
    await createSkillCase(deps)(WS, SKILL_ID, { name: 'b', expectation: EXP, input_diff: DIFF });
    const res = await createRunSkillCase(deps)(WS, SKILL_ID, a.id);
    expect(res.with_skill.pass).toBe(true);
    expect(res.without_skill.pass).toBe(false);
    expect(store.runs).toHaveLength(2);
    expect(await kindOf(createRunSkillCase(deps)(WS, 'skill-2', a.id))).toBe('not_found');
  });
  it('a model failure on one side is a failed result, not an exception', async () => {
    const runner = new ScriptedRunner((_a, _d, opts) => {
      if (opts?.skills?.length) throw new Error('provider down');
      return { kept: [], droppedCount: 0, costUsd: 0 };
    });
    const { deps } = setup(runner);
    const res = await createTrySkillCase(deps)(WS, SKILL_ID, { expectation: EXP, input_diff: DIFF });
    expect(res.with_skill.pass).toBe(false);
    expect(res.with_skill.output.error).toBe('provider down');
    expect(res.without_skill.output.error).toBeUndefined();
  });
  it('a trial run ("Run case" in the modal) stores nothing', async () => {
    const { deps, store, runner } = setup();
    const res = await createTrySkillCase(deps)(WS, SKILL_ID, { expectation: EXP, input_diff: DIFF });
    expect(res).toMatchObject({ agent_id: 'agent-1' });
    expect(res.with_skill.pass).toBe(true);
    expect(runner.calls).toHaveLength(2);
    expect(store.cases).toHaveLength(0);
    expect(store.runs).toHaveLength(0);
  });
});
