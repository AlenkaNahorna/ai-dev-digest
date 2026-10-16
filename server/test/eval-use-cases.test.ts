import { describe, it, expect } from 'vitest';
import {
  createCaseFromFinding,
  createDeleteCase,
  createImportFromDecisions,
  createListCases,
  createRunStoredCase,
  createTryCase,
  createUpdateCase,
} from '../src/modules/eval-pipeline/application/use-cases/cases.js';
import {
  BATCH_CONCURRENCY,
  createCompare,
  createListBatches,
  createOverview,
  createRunBatch,
} from '../src/modules/eval-pipeline/application/use-cases/batches.js';
import { EvalError } from '../src/modules/eval-pipeline/application/errors.js';
import { EvalExpectation, EvalBatchDetail, EvalCaseRecord } from '@devdigest/shared';
import { FakeAgents, FakeFindings, MemoryStore, ScriptedRunner, WS, agent, finding, kept, PR_DIFF } from './helpers/eval-fakes.js';

function setup(opts: { agents?: FakeAgents; findings?: FakeFindings; runner?: ScriptedRunner } = {}) {
  const store = new MemoryStore();
  const agents = opts.agents ?? new FakeAgents();
  const findings = opts.findings ?? new FakeFindings();
  const runner = opts.runner ?? new ScriptedRunner(() => ({ kept: [], droppedCount: 0, costUsd: 0.01 }));
  const deps = { store, agents, findings, runner };
  return { store, agents, findings, runner, deps };
}

const kindOf = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof EvalError ? e.kind : 'other'));

describe('create case from a finding (AC-1..AC-9)', () => {
  it('accepted → must_find with the finding location and a diff fragment', async () => {
    const f = finding({ decision: 'accepted' });
    const { deps, store } = setup({ findings: new FakeFindings([f]) });
    const rec = await createCaseFromFinding(deps).fromFindingId(WS, f.id);
    expect(EvalCaseRecord.safeParse(rec).success).toBe(true);
    expect(rec.expectation.kind).toBe('must_find');
    expect(rec.expectation).toMatchObject({ file: 'src/config.ts', start_line: 12, end_line: 12, severity: 'CRITICAL', category: 'security' });
    expect(rec.input_diff).toContain('+  stripeKey: "sk_live_abc",');
    expect(rec.input_diff).not.toContain('webhooks');
    expect(rec.agent_id).toBe('agent-1');
    expect(rec.source_finding_id).toBe(f.id);
    expect(rec.source_pr_id).toBe('pr-1');
    expect(rec.name).toBe('hardcoded-stripe-secret-key');
    expect(store.cases).toHaveLength(1);
    expect(EvalExpectation.safeParse(store.cases[0]!.expectation).success).toBe(true);
  });
  it('dismissed → must_not_flag', async () => {
    const f = finding({ decision: 'dismissed' });
    const { deps } = setup({ findings: new FakeFindings([f]) });
    expect((await createCaseFromFinding(deps).fromFindingId(WS, f.id)).expectation.kind).toBe('must_not_flag');
  });
  it('refuses an undecided finding (AC-6)', async () => {
    const f = finding({ decision: null });
    const { deps, store } = setup({ findings: new FakeFindings([f]) });
    expect(await kindOf(createCaseFromFinding(deps).fromFindingId(WS, f.id))).toBe('finding_undecided');
    expect(store.cases).toHaveLength(0);
  });
  it('refuses a second case for the same finding (AC-7)', async () => {
    const f = finding();
    const { deps, store } = setup({ findings: new FakeFindings([f]) });
    await createCaseFromFinding(deps).fromFindingId(WS, f.id);
    expect(await kindOf(createCaseFromFinding(deps).fromFindingId(WS, f.id))).toBe('eval_case_exists');
    expect(store.cases).toHaveLength(1);
  });
  it('refuses when the diff or the file is unavailable (AC-8)', async () => {
    const f = finding();
    const noDiff = new FakeFindings([f]);
    noDiff.diff = undefined;
    expect(await kindOf(createCaseFromFinding(setup({ findings: noDiff }).deps).fromFindingId(WS, f.id))).toBe('diff_unavailable');
    const g = finding({ file: 'src/not-in-diff.ts' });
    expect(await kindOf(createCaseFromFinding(setup({ findings: new FakeFindings([g]) }).deps).fromFindingId(WS, g.id))).toBe('diff_unavailable');
  });
  it('is workspace-scoped and makes no model call (AC-9)', async () => {
    const f = finding();
    const { deps, runner } = setup({ findings: new FakeFindings([f]) });
    expect(await kindOf(createCaseFromFinding(deps).fromFindingId('other-ws', f.id))).toBe('not_found');
    await createCaseFromFinding(deps).fromFindingId(WS, f.id);
    expect(runner.calls).toHaveLength(0);
  });
  it('keeps names unique for two findings with the same title', async () => {
    const a = finding({ startLine: 12, endLine: 12 });
    const b = finding({ startLine: 11, endLine: 11 });
    const { deps } = setup({ findings: new FakeFindings([a, b]) });
    const c = createCaseFromFinding(deps);
    const r1 = await c.fromFindingId(WS, a.id);
    const r2 = await c.fromFindingId(WS, b.id);
    expect(r1.name).not.toBe(r2.name);
  });
  it('refuses a finding of a summary review without an agent', async () => {
    const f = finding({ agentId: null });
    expect(await kindOf(createCaseFromFinding(setup({ findings: new FakeFindings([f]) }).deps).fromFindingId(WS, f.id))).toBe('finding_without_agent');
  });
});

describe('modal: draft, edited save and "Run case"', () => {
  it('the draft is the seeded case, stores nothing and calls no model', async () => {
    const f = finding({ decision: 'dismissed' });
    const { deps, store, runner } = setup({ findings: new FakeFindings([f]) });
    const draft = await createCaseFromFinding(deps).draftFromFindingId(WS, f.id);
    expect(draft).toMatchObject({ agent_id: 'agent-1', source_finding_id: f.id, source_pr_id: 'pr-1' });
    expect(draft.expectation.kind).toBe('must_not_flag');
    expect(draft.input_diff).toContain('+  stripeKey: "sk_live_abc",');
    expect(store.cases).toHaveLength(0);
    expect(runner.calls).toHaveLength(0);
  });
  it('the draft refuses an undecided or already-converted finding like the save does', async () => {
    const undecided = finding({ decision: null });
    const a = setup({ findings: new FakeFindings([undecided]) });
    expect(await kindOf(createCaseFromFinding(a.deps).draftFromFindingId(WS, undecided.id))).toBe('finding_undecided');
    const f = finding();
    const b = setup({ findings: new FakeFindings([f]) });
    await createCaseFromFinding(b.deps).fromFindingId(WS, f.id);
    expect(await kindOf(createCaseFromFinding(b.deps).draftFromFindingId(WS, f.id))).toBe('eval_case_exists');
  });
  it('saves the edits the user made and keeps the seeded rest', async () => {
    const f = finding({ decision: 'accepted' });
    const { deps, store } = setup({ findings: new FakeFindings([f]) });
    const draft = await createCaseFromFinding(deps).draftFromFindingId(WS, f.id);
    const rec = await createCaseFromFinding(deps).fromFindingId(WS, f.id, {
      name: 'my stripe case',
      expectation: { ...draft.expectation, start_line: 10, end_line: 14 },
    });
    expect(rec.name).toBe('my stripe case');
    expect(rec.expectation).toMatchObject({ kind: 'must_find', start_line: 10, end_line: 14 });
    expect(rec.input_diff).toBe(draft.input_diff);
    expect(store.cases).toHaveLength(1);
  });
  it('"Run case" scores one draft in code and stores nothing', async () => {
    const f = finding({ decision: 'accepted' });
    const { deps, store } = setup({ findings: new FakeFindings([f]) });
    const draft = await createCaseFromFinding(deps).draftFromFindingId(WS, f.id);
    const runner = new ScriptedRunner(() => ({ kept: [kept('src/config.ts', 11, 13)], droppedCount: 1, costUsd: 0.02 }));
    const res = await createTryCase({ agents: deps.agents, runner })(WS, draft.agent_id, {
      expectation: draft.expectation,
      input_diff: draft.input_diff,
    });
    expect(res).toMatchObject({ pass: true, cost_usd: 0.02, agent_version: 1 });
    expect(res.output).toMatchObject({ emitted: 2, kept: 1, dropped: 1, hits: 1, noise: 0 });
    expect(runner.calls).toHaveLength(1);
    expect(store.cases).toHaveLength(0);
    expect(store.runs).toHaveLength(0);
  });
  it('"Run case" turns a model failure into a failed result instead of throwing', async () => {
    const { deps } = setup();
    const runner = new ScriptedRunner(() => {
      throw new Error('boom');
    });
    const res = await createTryCase({ agents: deps.agents, runner })(WS, 'agent-1', {
      expectation: { kind: 'must_find', file: 'a.ts', start_line: 1, end_line: 2, title: 't', severity: 'WARNING', category: 'bug' },
      input_diff: 'diff',
    });
    expect(res.pass).toBe(false);
    expect(res.output.error).toBe('boom');
  });
  it('"Run case" 404s for an agent of another workspace', async () => {
    const { deps, runner } = setup();
    expect(
      await kindOf(
        createTryCase({ agents: deps.agents, runner })('other-ws', 'agent-1', {
          expectation: { kind: 'must_find', file: 'a.ts', start_line: 1, end_line: 1, title: 't', severity: 'WARNING', category: 'bug' },
          input_diff: 'diff',
        }),
      ),
    ).toBe('not_found');
    expect(runner.calls).toHaveLength(0);
  });
});

describe('row actions: edit and run one case', () => {
  async function stored(decision: 'accepted' | 'dismissed' = 'accepted') {
    const f = finding({ decision });
    const s = setup({ findings: new FakeFindings([f]) });
    const rec = await createCaseFromFinding(s.deps).fromFindingId(WS, f.id);
    return { ...s, rec };
  }
  it('edit changes only the given fields and 404s for a missing or foreign case', async () => {
    const { deps, store, rec } = await stored();
    const out = await createUpdateCase(deps)(WS, rec.id, { name: 'renamed' });
    expect(out.name).toBe('renamed');
    expect(out.input_diff).toBe(rec.input_diff);
    expect(out.expectation).toEqual(rec.expectation);
    const exp = { ...rec.expectation, kind: 'must_not_flag' as const };
    expect((await createUpdateCase(deps)(WS, rec.id, { expectation: exp })).expectation.kind).toBe('must_not_flag');
    expect(store.cases[0]!.name).toBe('renamed');
    expect(await kindOf(createUpdateCase(deps)(WS, 'nope', { name: 'x' }))).toBe('not_found');
    expect(await kindOf(createUpdateCase(deps)('other-ws', rec.id, { name: 'x' }))).toBe('not_found');
  });
  it('running one case stores its latest result but no batch', async () => {
    const { deps, store, rec } = await stored();
    const runner = new ScriptedRunner(() => ({ kept: [kept('src/config.ts', 12)], droppedCount: 0, costUsd: 0.01 }));
    const res = await createRunStoredCase({ ...deps, runner })(WS, rec.id);
    expect(res.pass).toBe(true);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]!.diff).toBe(rec.input_diff);
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]!.batchId).toBeNull();
    const list = await createListCases(deps)(WS, 'agent-1');
    expect(list.cases[0]!.latest).toMatchObject({ pass: true, batch_id: null, summary: { kept: 1, hits: 1, noise: 0 } });
    expect((await createListBatches(deps)(WS, 'agent-1')).batches).toHaveLength(0);
  });
  it('a failed single run is stored as a fail with the error, not thrown', async () => {
    const { deps, store, rec } = await stored();
    const runner = new ScriptedRunner(() => {
      throw new Error('provider down');
    });
    const res = await createRunStoredCase({ ...deps, runner })(WS, rec.id);
    expect(res.pass).toBe(false);
    expect(res.output.error).toBe('provider down');
    expect(store.runs).toHaveLength(1);
  });
  it('running a missing or foreign case calls no model', async () => {
    const { deps, runner } = await stored();
    expect(await kindOf(createRunStoredCase({ ...deps, runner })('other-ws', 'x'))).toBe('not_found');
    expect(runner.calls).toHaveLength(0);
  });
});

describe('list / delete / import (AC-10..AC-12, AC-45)', () => {
  it('lists cases with the latest pass/fail or "never run"', async () => {
    const a = finding();
    const b = finding({ startLine: 12, endLine: 12, title: 'Other', decision: 'dismissed' });
    const { deps, store } = setup({ findings: new FakeFindings([a, b]), runner: new ScriptedRunner(() => ({ kept: [kept('src/config.ts', 12)], droppedCount: 0, costUsd: null })) });
    const c = createCaseFromFinding(deps);
    await c.fromFindingId(WS, a.id);
    await c.fromFindingId(WS, b.id);
    const before = await createListCases(deps)(WS, 'agent-1');
    expect(before.cases).toHaveLength(2);
    expect(before.cases.every((x) => x.latest === null)).toBe(true);
    await createRunBatch(deps)(WS, 'agent-1');
    const after = await createListCases(deps)(WS, 'agent-1');
    expect(after.with_runs).toBe(2);
    expect(after.passing).toBe(1); // must_find passes; must_not_flag on the same line fails
    expect(store.runs).toHaveLength(2);
  });
  it('404s for an agent of another workspace (AC-21)', async () => {
    const { deps } = setup();
    expect(await kindOf(createListCases(deps)('other-ws', 'agent-1'))).toBe('not_found');
    expect(await kindOf(createRunBatch(deps)('other-ws', 'agent-1'))).toBe('not_found');
  });
  it('deletes a case with its runs and 404s on a missing one', async () => {
    const f = finding();
    const { deps, store } = setup({ findings: new FakeFindings([f]) });
    const rec = await createCaseFromFinding(deps).fromFindingId(WS, f.id);
    await createRunBatch(deps)(WS, 'agent-1');
    await createDeleteCase(deps)(WS, rec.id);
    expect(store.cases).toHaveLength(0);
    expect(store.runs).toHaveLength(0);
    expect(await kindOf(createDeleteCase(deps)(WS, rec.id))).toBe('not_found');
  });
  it('imports every decided finding once and skips existing ones', async () => {
    const a = finding();
    const b = finding({ startLine: 11, endLine: 11, decision: 'dismissed', title: 'B' });
    const u = finding({ decision: null, title: 'U' });
    const bad = finding({ file: 'src/not-in-diff.ts', title: 'Bad' });
    const { deps } = setup({ findings: new FakeFindings([a, b, u, bad]) });
    const imp = createImportFromDecisions(deps);
    expect(await imp(WS, 'agent-1')).toEqual({ created: 2, skipped: 0, failed: 1 });
    expect(await imp(WS, 'agent-1')).toEqual({ created: 0, skipped: 2, failed: 1 });
  });
});

async function seedCases(findings: FakeFindings, deps: ReturnType<typeof setup>['deps']) {
  const c = createCaseFromFinding(deps);
  for (const f of findings.items) await c.fromFindingId(WS, f.id);
}

const mustFindF = () => finding({ title: 'Stripe key', file: 'src/config.ts', startLine: 12, endLine: 12, decision: 'accepted' });
const ssrfF = () => finding({ title: 'SSRF forward', file: 'src/api/webhooks.ts', startLine: 61, endLine: 62, decision: 'accepted', severity: 'CRITICAL' });
const noiseF = () => finding({ title: 'Unused import', file: 'src/api/webhooks.ts', startLine: 2, endLine: 2, decision: 'dismissed', severity: 'SUGGESTION', category: 'style' });

describe('run a batch (AC-13..AC-21)', () => {
  it('refuses an agent without cases and calls no model (AC-16)', async () => {
    const { deps, runner } = setup();
    expect(await kindOf(createRunBatch(deps)(WS, 'agent-1'))).toBe('no_eval_cases');
    expect(runner.calls).toHaveLength(0);
  });

  it('runs every case once with fixed inputs and stores one batch (AC-13, AC-14, AC-18, AC-20)', async () => {
    const fs = new FakeFindings([mustFindF(), ssrfF(), noiseF()]);
    const runner = new ScriptedRunner((a, diff) => {
      if (diff.includes('stripeKey')) return { kept: [kept('src/config.ts', 12)], droppedCount: 0, costUsd: 0.02 };
      if (diff.includes('fetch(url)')) return { kept: [kept('src/api/webhooks.ts', 61, 62)], droppedCount: 1, costUsd: 0.02 };
      return { kept: [], droppedCount: 0, costUsd: 0.02 };
    });
    const { deps, store } = setup({ findings: fs, runner });
    await seedCases(fs, deps);
    const detail = await createRunBatch(deps)(WS, 'agent-1');

    expect(EvalBatchDetail.safeParse(detail).success).toBe(true);
    expect(runner.calls).toHaveLength(3);
    // the runner only ever sees the agent and the stored fragment — nothing else
    expect(new Set(runner.calls.map((c) => c.agent.systemPrompt))).toEqual(new Set(['good prompt']));
    expect(runner.calls.every((c) => c.diff.startsWith('diff --git'))).toBe(true);
    expect(detail.summary.cases_total).toBe(3);
    expect(detail.summary.cases_passed).toBe(3);
    expect(detail.summary.recall).toBe(1);
    expect(detail.summary.precision).toBe(1);
    expect(detail.summary.citation_accuracy).toBeCloseTo(2 / 3, 10);
    expect(detail.summary.agent_version).toBe(1);
    expect(detail.summary.model).toBe('gpt-4.1');
    expect(detail.summary.cost_usd).toBeCloseTo(0.06, 10);
    expect(new Set(store.runs.map((r) => r.batchId)).size).toBe(1);
  });

  it('isolates a failing case: miss for recall, out of precision and citation (AC-17)', async () => {
    const fs = new FakeFindings([mustFindF(), ssrfF()]);
    const runner = new ScriptedRunner((_a, diff) => {
      if (diff.includes('fetch(url)')) throw new Error('model exploded');
      return { kept: [kept('src/config.ts', 12)], droppedCount: 0, costUsd: null };
    });
    const { deps } = setup({ findings: fs, runner });
    await seedCases(fs, deps);
    const detail = await createRunBatch(deps)(WS, 'agent-1');
    expect(detail.summary.errors).toBe(1);
    expect(detail.summary.recall).toBe(0.5);
    expect(detail.summary.precision).toBe(1);
    expect(detail.summary.citation_accuracy).toBe(1);
    expect(detail.results.find((r) => r.output.error)?.output.error).toContain('model exploded');
  });

  it('never exceeds the concurrency cap (AC-19)', async () => {
    const fs = new FakeFindings([mustFindF(), ssrfF(), noiseF()]);
    let active = 0;
    let peak = 0;
    const runner = new ScriptedRunner(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return { kept: [], droppedCount: 0, costUsd: null };
    });
    const { deps } = setup({ findings: fs, runner });
    await seedCases(fs, deps);
    await createRunBatch(deps)(WS, 'agent-1');
    expect(peak).toBeLessThan(BATCH_CONCURRENCY + 1);
    expect(peak).toBeGreaterThan(0);
  });

  it('skips a case whose expected_output is invalid instead of crashing (AC-42)', async () => {
    const fs = new FakeFindings([mustFindF()]);
    const { deps, store } = setup({ findings: fs, runner: new ScriptedRunner(() => ({ kept: [kept('src/config.ts', 12)], droppedCount: 0, costUsd: null })) });
    await seedCases(fs, deps);
    store.cases.push({ ...store.cases[0]!, id: 'bad', name: 'bad', sourceFindingId: 'x', expectation: { nonsense: true } });
    const detail = await createRunBatch(deps)(WS, 'agent-1');
    expect(detail.summary.cases_total).toBe(1);
    expect((await createListCases(deps)(WS, 'agent-1')).cases).toHaveLength(1);
  });
});

describe('sensitivity: a worse prompt moves the metrics (AC-44)', () => {
  // The "model" is a stub driven by the agent's system prompt — no LLM anywhere.
  const stub = new ScriptedRunner((a, diff) => {
    const sloppy = a.systemPrompt.includes('flag everything');
    const out = [];
    if (diff.includes('stripeKey') && !sloppy) out.push(kept('src/config.ts', 12));
    if (diff.includes('fetch(url)') && !sloppy) out.push(kept('src/api/webhooks.ts', 61, 62));
    if (sloppy && diff.includes('import { z }')) out.push(kept('src/api/webhooks.ts', 2)); // noise on the dismissed line
    if (sloppy && diff.includes('stripeKey')) out.push(kept('src/config.ts', 11)); // wrong line, not a hit
    return { kept: out, droppedCount: sloppy ? 2 : 0, costUsd: 0.01 };
  });

  it('recall drops, precision drops and citation drops for the degraded prompt', async () => {
    const fs = new FakeFindings([mustFindF(), ssrfF(), noiseF()]);
    const agents = new FakeAgents([agent({ version: 1, systemPrompt: 'be precise' })]);
    const { deps } = setup({ findings: fs, agents, runner: stub });
    await seedCases(fs, deps);
    const good = await createRunBatch(deps)(WS, 'agent-1');

    agents.list = [agent({ version: 2, systemPrompt: 'flag everything you can' })];
    const bad = await createRunBatch(deps)(WS, 'agent-1');

    expect(good.summary.recall).toBe(1);
    expect(good.summary.precision).toBe(1);
    expect(bad.summary.recall).toBe(0);
    expect(bad.summary.precision!).toBeLessThan(good.summary.precision!);
    expect(bad.summary.citation_accuracy!).toBeLessThan(good.summary.citation_accuracy!);
    expect(bad.summary.cases_passed).toBeLessThan(good.summary.cases_passed);
  });

  it('compare reports deltas, per-case changes and both prompts (AC-35)', async () => {
    const fs = new FakeFindings([mustFindF(), ssrfF(), noiseF()]);
    const agents = new FakeAgents([agent({ version: 1, systemPrompt: 'be precise' })]);
    agents.versions.set('agent-1:1', { provider: 'openai', model: 'gpt-4.1', systemPrompt: 'be precise' });
    agents.versions.set('agent-1:2', { provider: 'openai', model: 'gpt-4.1', systemPrompt: 'flag everything you can' });
    const { deps } = setup({ findings: fs, agents, runner: stub });
    await seedCases(fs, deps);
    const good = await createRunBatch(deps)(WS, 'agent-1');
    agents.list = [agent({ version: 2, systemPrompt: 'flag everything you can' })];
    const bad = await createRunBatch(deps)(WS, 'agent-1');

    const cmp = await createCompare(deps)(WS, good.summary.batch_id, bad.summary.batch_id);
    expect(cmp.delta.recall).toBe(-1);
    expect(cmp.delta.precision!).toBeLessThan(0);
    expect(cmp.config_a.system_prompt).toBe('be precise');
    expect(cmp.config_b.system_prompt).toBe('flag everything you can');
    expect(cmp.cases.filter((c) => c.a === true && c.b === false).length).toBeGreaterThan(0);
  });

  it('compare refuses runs of different agents', async () => {
    const fs = new FakeFindings([mustFindF()]);
    const agents = new FakeAgents([agent(), agent({ id: 'agent-2', name: 'Other' })]);
    const { deps, store } = setup({ findings: fs, agents, runner: stub });
    await seedCases(fs, deps);
    const one = await createRunBatch(deps)(WS, 'agent-1');
    // a second agent with its own case
    const g = finding({ agentId: 'agent-2', title: 'Other agent finding' });
    fs.items.push(g);
    await createCaseFromFinding(deps).fromFindingId(WS, g.id);
    const two = await createRunBatch(deps)(WS, 'agent-2');
    expect(await kindOf(createCompare(deps)(WS, one.summary.batch_id, two.summary.batch_id))).toBe('batches_mismatch');
    expect(store.runs.length).toBeGreaterThan(1);
  });
});

describe('history and dashboard (AC-34, AC-38)', () => {
  it('lists batches newest first and builds the overview', async () => {
    const fs = new FakeFindings([mustFindF()]);
    const agents = new FakeAgents([agent(), agent({ id: 'agent-2', name: 'Idle' })]);
    const { deps } = setup({ findings: fs, agents, runner: new ScriptedRunner(() => ({ kept: [kept('src/config.ts', 12)], droppedCount: 0, costUsd: null })) });
    await seedCases(fs, deps);
    const first = await createRunBatch(deps)(WS, 'agent-1');
    const second = await createRunBatch(deps)(WS, 'agent-1');
    const list = await createListBatches(deps)(WS, 'agent-1');
    expect(list.batches.map((b) => b.batch_id)).toEqual([second.summary.batch_id, first.summary.batch_id]);

    const overview = await createOverview(deps)(WS);
    const a1 = overview.agents.find((a) => a.agent_id === 'agent-1')!;
    expect(a1.cases_total).toBe(1);
    expect(a1.latest?.batch_id).toBe(second.summary.batch_id);
    expect(a1.trend).toHaveLength(2);
    expect(overview.agents.find((a) => a.agent_id === 'agent-2')?.latest).toBeNull();
    expect(overview.recent).toHaveLength(2);
    expect(PR_DIFF.length).toBeGreaterThan(0);
  });
});
