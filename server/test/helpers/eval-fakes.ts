import { randomUUID } from 'node:crypto';
import type {
  SkillConfigPort,
  SkillInfo,
  AgentConfigPort,
  AgentInfo,
  AgentRunnerPort,
  BatchRef,
  BatchRow,
  EvalStorePort,
  FindingSourcePort,
  NewCase,
  NewRun,
  RunnerResult,
  SourceFinding,
  StoredCase,
  StoredRun,
} from '../../src/modules/eval-pipeline/application/ports/eval-ports.js';

export const WS = 'ws-1';

export const PR_DIFF = [
  'diff --git a/src/config.ts b/src/config.ts',
  'index 111..222 100644',
  '--- a/src/config.ts',
  '+++ b/src/config.ts',
  '@@ -10,6 +10,7 @@',
  ' export const config = {',
  '   port: Number(process.env.PORT ?? 3000),',
  '+  stripeKey: "sk_live_abc",',
  '   redisUrl: process.env.REDIS_URL,',
  ' };',
  ' ',
  ' export default config;',
  'diff --git a/src/api/webhooks.ts b/src/api/webhooks.ts',
  'index 333..444 100644',
  '--- a/src/api/webhooks.ts',
  '+++ b/src/api/webhooks.ts',
  '@@ -1,3 +1,4 @@',
  ' import http from "node:http";',
  '+import { z } from "zod";',
  ' ',
  ' const x = 1;',
  '@@ -58,6 +59,8 @@',
  ' export async function forward(req) {',
  '+  const url = req.body.url;',
  '+  await fetch(url);',
  '   return ok();',
  ' }',
  ' ',
  ' // end',
  '',
].join('\n');

export function agent(over: Partial<AgentInfo> = {}): AgentInfo {
  return { id: 'agent-1', name: 'Security Reviewer', provider: 'openai', model: 'gpt-4.1', version: 1, systemPrompt: 'good prompt', ...over };
}

export function finding(over: Partial<SourceFinding> = {}): SourceFinding {
  return {
    id: randomUUID(),
    prId: 'pr-1',
    agentId: 'agent-1',
    file: 'src/config.ts',
    startLine: 12,
    endLine: 12,
    title: 'Hardcoded Stripe secret key',
    severity: 'CRITICAL',
    category: 'security',
    decision: 'accepted',
    ...over,
  };
}

export class FakeFindings implements FindingSourcePort {
  constructor(
    public items: SourceFinding[] = [],
    public diff: string | undefined = PR_DIFF,
    private workspace = WS,
  ) {}
  async getFinding(ws: string, id: string) {
    return ws === this.workspace ? this.items.find((f) => f.id === id) : undefined;
  }
  async listDecided(ws: string, agentId: string) {
    return ws === this.workspace ? this.items.filter((f) => f.agentId === agentId && f.decision) : [];
  }
  async loadPrDiff() {
    return this.diff;
  }
}

export class FakeAgents implements AgentConfigPort {
  public versions = new Map<string, { provider: string | null; model: string | null; systemPrompt: string | null }>();
  constructor(public list: AgentInfo[] = [agent()]) {}
  async getAgent(ws: string, id: string) {
    return ws === WS ? this.list.find((a) => a.id === id) : undefined;
  }
  async listAgents(ws: string) {
    return ws === WS ? this.list : [];
  }
  async getVersionConfig(agentId: string, version: number) {
    return this.versions.get(`${agentId}:${version}`);
  }
}

export class MemoryStore implements EvalStorePort {
  cases: (StoredCase & { workspaceId: string })[] = [];
  runs: (StoredRun & { agentId: string })[] = [];
  private clock = 1_700_000_000_000;

  async listCases(ws: string, agentId: string) {
    return this.cases.filter((c) => c.workspaceId === ws && c.agentId === agentId && c.ownerKind === 'agent');
  }
  async findCaseBySource(ws: string, agentId: string, findingId: string) {
    return this.cases.find((c) => c.workspaceId === ws && c.agentId === agentId && c.sourceFindingId === findingId);
  }
  async insertCase(ws: string, input: NewCase) {
    if (this.cases.some((c) => c.agentId === input.agentId && c.sourceFindingId === input.sourceFindingId)) return 'duplicate' as const;
    const row = { id: randomUUID(), workspaceId: ws, ownerKind: 'agent' as const, ...input, createdAt: new Date(this.clock++) };
    this.cases.push(row);
    return row;
  }
  async insertManualCase(ws: string, input: { agentId: string; name: string; inputDiff: string; expectation: unknown }) {
    const row = {
      id: randomUUID(), workspaceId: ws, ownerKind: 'agent' as const, agentId: input.agentId, name: input.name, inputDiff: input.inputDiff,
      expectation: input.expectation, sourceFindingId: null, sourcePrId: null, createdAt: new Date(this.clock++),
    };
    this.cases.push(row);
    return row;
  }
  async listSkillCases(ws: string, skillId: string) {
    return this.cases.filter((c) => c.workspaceId === ws && c.agentId === skillId && c.ownerKind === 'skill');
  }
  async insertSkillCase(ws: string, input: { skillId: string; name: string; inputDiff: string; expectation: unknown }) {
    const row = {
      id: randomUUID(), workspaceId: ws, ownerKind: 'skill' as const, agentId: input.skillId, name: input.name, inputDiff: input.inputDiff,
      expectation: input.expectation, sourceFindingId: null, sourcePrId: null, createdAt: new Date(this.clock++),
    };
    this.cases.push(row);
    return row;
  }
  async latestSkillRuns(ws: string, skillId: string) {
    const out = new Map<string, { withSkill?: StoredRun; withoutSkill?: StoredRun }>();
    const ids = new Set(this.cases.filter((c) => c.workspaceId === ws && c.agentId === skillId && c.ownerKind === 'skill').map((c) => c.id));
    for (const r of [...this.runs].filter((x) => ids.has(x.caseId)).sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime())) {
      const v = (r.actualOutput as { variant?: string } | null)?.variant;
      const slot = out.get(r.caseId) ?? {};
      if (v === 'with_skill' && !slot.withSkill) slot.withSkill = r;
      if (v === 'without_skill' && !slot.withoutSkill) slot.withoutSkill = r;
      out.set(r.caseId, slot);
    }
    return out;
  }
  async getCase(ws: string, id: string) {
    return this.cases.find((c) => c.workspaceId === ws && c.id === id);
  }
  async updateCase(ws: string, id: string, patch: { name?: string; inputDiff?: string; expectation?: unknown }) {
    const c = this.cases.find((x) => x.workspaceId === ws && x.id === id);
    if (!c) return undefined;
    if (patch.name !== undefined) c.name = patch.name;
    if (patch.inputDiff !== undefined) c.inputDiff = patch.inputDiff;
    if (patch.expectation !== undefined) c.expectation = patch.expectation;
    return c;
  }
  async deleteCase(ws: string, id: string) {
    const before = this.cases.length;
    this.cases = this.cases.filter((c) => !(c.workspaceId === ws && c.id === id));
    this.runs = this.runs.filter((r) => r.caseId !== id);
    return this.cases.length < before;
  }
  async countCasesByAgent(ws: string) {
    const m = new Map<string, number>();
    for (const c of this.cases.filter((x) => x.workspaceId === ws)) m.set(c.agentId, (m.get(c.agentId) ?? 0) + 1);
    return m;
  }
  async insertRuns(runs: NewRun[]) {
    const ranAt = new Date((this.clock += 60_000));
    for (const r of runs) {
      const c = this.cases.find((x) => x.id === r.caseId)!;
      this.runs.push({
        id: randomUUID(), caseId: r.caseId, batchId: r.batchId, ranAt, pass: r.pass, actualOutput: r.actualOutput,
        durationMs: r.durationMs, costUsd: r.costUsd, agentVersion: r.agentVersion, provider: r.provider, model: r.model, agentId: c.agentId,
      });
    }
  }
  async latestRunByCase(ws: string, agentId: string) {
    const m = new Map<string, StoredRun>();
    for (const r of [...this.runs].filter((x) => x.agentId === agentId).sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime())) {
      if (!m.has(r.caseId)) m.set(r.caseId, r);
    }
    return m;
  }
  async listBatchRefs(_ws: string, agentId: string | undefined, limit: number): Promise<BatchRef[]> {
    const refs = new Map<string, BatchRef>();
    for (const r of this.runs) {
      if (!r.batchId || (agentId && r.agentId !== agentId)) continue;
      const cur = refs.get(r.batchId);
      if (!cur || r.ranAt > cur.ranAt) refs.set(r.batchId, { batchId: r.batchId, agentId: r.agentId, ranAt: r.ranAt });
    }
    return [...refs.values()].sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime()).slice(0, limit);
  }
  async rowsForBatches(_ws: string, ids: string[]): Promise<BatchRow[]> {
    return this.runs
      .filter((r) => r.batchId && ids.includes(r.batchId))
      .map((r) => {
        const c = this.cases.find((x) => x.id === r.caseId)!;
        return { ...r, caseName: c.name, expectation: c.expectation };
      });
  }
}

export class ScriptedRunner implements AgentRunnerPort {
  calls: { agent: AgentInfo; diff: string; skills?: string[] }[] = [];
  constructor(private fn: (agent: AgentInfo, diff: string, opts?: { skills?: string[] }) => RunnerResult | Promise<RunnerResult>) {}
  async run(a: AgentInfo, diff: string, opts?: { skills?: string[] }) {
    this.calls.push({ agent: a, diff, skills: opts?.skills });
    return this.fn(a, diff, opts);
  }
}

export const SKILL_ID = 'skill-1';

export class FakeSkills implements SkillConfigPort {
  constructor(
    public skills: SkillInfo[] = [{ id: SKILL_ID, name: 'breaking-change', version: 3, body: 'Flag removed public fields.' }],
    public linked: AgentInfo | undefined = agent(),
  ) {}
  async getSkill(ws: string, id: string) {
    return ws === WS ? this.skills.find((s) => s.id === id) : undefined;
  }
  async linkedAgent(ws: string, _skillId: string) {
    return ws === WS ? this.linked : undefined;
  }
}

export const kept = (file: string, startLine: number, endLine = startLine, title = 'finding') => ({ file, startLine, endLine, title, severity: 'WARNING' });
