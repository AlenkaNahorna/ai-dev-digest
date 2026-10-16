/** Narrow ports of the eval pipeline. Implemented by `adapters/outbound/*`. */

export interface SourceFinding {
  id: string;
  prId: string;
  /** The agent that produced the finding (via its review); null for summary reviews. */
  agentId: string | null;
  file: string;
  startLine: number;
  endLine: number;
  title: string;
  severity: string;
  category: string;
  decision: 'accepted' | 'dismissed' | null;
}

export interface FindingSourcePort {
  /** Workspace-scoped; `undefined` → not found. */
  getFinding(workspaceId: string, findingId: string): Promise<SourceFinding | undefined>;
  /** Accepted or dismissed findings of the agent's reviews, newest first. */
  listDecided(workspaceId: string, agentId: string): Promise<SourceFinding[]>;
  /** Raw unified diff of the PR (git, with `pr_files` fallback); `undefined` when unavailable. */
  loadPrDiff(workspaceId: string, prId: string): Promise<string | undefined>;
}

export interface AgentInfo {
  id: string;
  name: string;
  provider: string;
  model: string;
  version: number;
  systemPrompt: string;
}

export interface AgentConfigPort {
  getAgent(workspaceId: string, agentId: string): Promise<AgentInfo | undefined>;
  listAgents(workspaceId: string): Promise<AgentInfo[]>;
  /** Immutable snapshot recorded when that version was created. */
  getVersionConfig(
    agentId: string,
    version: number,
  ): Promise<{ provider: string | null; model: string | null; systemPrompt: string | null } | undefined>;
}

export interface StoredCase {
  id: string;
  /** `agent` or `skill` — `agentId` holds the owner id of either kind. */
  ownerKind: 'agent' | 'skill';
  agentId: string;
  name: string;
  inputDiff: string;
  /** Raw JSON from `expected_output` — validated by the use-case, never trusted. */
  expectation: unknown;
  sourceFindingId: string | null;
  sourcePrId: string | null;
  createdAt: Date | null;
}

export interface NewCase {
  agentId: string;
  name: string;
  inputDiff: string;
  expectation: unknown;
  sourceFindingId: string;
  sourcePrId: string;
}

export interface StoredRun {
  id: string;
  caseId: string;
  batchId: string | null;
  ranAt: Date;
  pass: boolean | null;
  actualOutput: unknown;
  durationMs: number | null;
  costUsd: number | null;
  agentVersion: number | null;
  provider: string | null;
  model: string | null;
}

export interface NewSkillCase {
  skillId: string;
  name: string;
  inputDiff: string;
  expectation: unknown;
}

export interface NewRun {
  caseId: string;
  /** null → a single-case run: updates the case's latest result, stays out of batch history. */
  batchId: string | null;
  pass: boolean;
  actualOutput: unknown;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number;
  costUsd: number | null;
  agentVersion: number;
  provider: string;
  model: string;
}

export interface BatchRow extends StoredRun {
  agentId: string;
  caseName: string;
  expectation: unknown;
}

export interface BatchRef {
  batchId: string;
  agentId: string;
  ranAt: Date;
}

export interface EvalStorePort {
  listCases(workspaceId: string, agentId: string): Promise<StoredCase[]>;
  findCaseBySource(workspaceId: string, agentId: string, findingId: string): Promise<StoredCase | undefined>;
  /** `'duplicate'` when the unique (agent, finding) index rejects the insert. */
  insertCase(workspaceId: string, input: NewCase): Promise<StoredCase | 'duplicate'>;
  listSkillCases(workspaceId: string, skillId: string): Promise<StoredCase[]>;
  insertSkillCase(workspaceId: string, input: NewSkillCase): Promise<StoredCase>;
  /** Newest run per case and variant (`with_skill` / `without_skill`, read from `actual_output.variant`). */
  latestSkillRuns(
    workspaceId: string,
    skillId: string,
  ): Promise<Map<string, { withSkill?: StoredRun; withoutSkill?: StoredRun }>>;
  getCase(workspaceId: string, caseId: string): Promise<StoredCase | undefined>;
  /** Only the given fields change; `undefined` → not found. */
  updateCase(
    workspaceId: string,
    caseId: string,
    patch: { name?: string; inputDiff?: string; expectation?: unknown },
  ): Promise<StoredCase | undefined>;
  deleteCase(workspaceId: string, caseId: string): Promise<boolean>;
  countCasesByAgent(workspaceId: string): Promise<Map<string, number>>;
  insertRuns(runs: NewRun[]): Promise<void>;
  latestRunByCase(workspaceId: string, agentId: string): Promise<Map<string, StoredRun>>;
  /** Newest batch first. */
  listBatchRefs(workspaceId: string, agentId: string | undefined, limit: number): Promise<BatchRef[]>;
  rowsForBatches(workspaceId: string, batchIds: string[]): Promise<BatchRow[]>;
}

export interface RunnerFinding {
  file: string;
  startLine: number;
  endLine: number;
  title: string;
  severity: string;
}

export interface RunnerResult {
  /** Findings that survived the grounding gate. */
  kept: RunnerFinding[];
  droppedCount: number;
  costUsd: number | null;
}

/** Runs the agent once on one diff fragment with FIXED inputs (AC-14). */
export interface AgentRunnerPort {
  /** `skills` (prompt-ready texts) replaces the agent's linked skills — `[]` runs with none. */
  run(agent: AgentInfo, diffText: string, opts?: { skills?: string[] }): Promise<RunnerResult>;
}

export interface SkillInfo {
  id: string;
  name: string;
  version: number;
  body: string;
}

export interface SkillConfigPort {
  getSkill(workspaceId: string, skillId: string): Promise<SkillInfo | undefined>;
  /** The agent the skill is judged on: the first enabled agent the skill is linked to. */
  linkedAgent(workspaceId: string, skillId: string): Promise<AgentInfo | undefined>;
}

export interface EvalLogPort {
  warn(message: string, fields?: Record<string, unknown>): void;
}
