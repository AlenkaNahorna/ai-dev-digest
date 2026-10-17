import { z } from 'zod';
import { FindingCategory, Severity } from './findings.js';

/**
 * L06 — Eval Pipeline contracts (regression set for review agents).
 * A case is born from a decided finding: accepted → `must_find`, dismissed → `must_not_flag`.
 * Scoring is code-only (file match + line overlap); see `specs/eval-pipeline.md`.
 * Extends the barrel; `knowledge.ts` / `eval-ci.ts` are left untouched.
 */

export const EvalExpectationKind = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectationKind = z.infer<typeof EvalExpectationKind>;

/** Stored in `eval_cases.expected_output`. Lines are new-side, inclusive. */
export const EvalExpectation = z.object({
  kind: EvalExpectationKind,
  file: z.string().min(1),
  start_line: z.number().int().min(1),
  end_line: z.number().int().min(1),
  title: z.string(),
  severity: Severity,
  category: FindingCategory,
});
export type EvalExpectation = z.infer<typeof EvalExpectation>;

/** A kept finding as stored in a run's `actual_output` (numbers + short text only). */
export const EvalActualFinding = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  title: z.string(),
  severity: z.string(),
});
export type EvalActualFinding = z.infer<typeof EvalActualFinding>;

/** Stored in `eval_runs.actual_output`. */
export const EvalActualOutput = z.object({
  emitted: z.number().int(),
  kept: z.number().int(),
  dropped: z.number().int(),
  hits: z.number().int(),
  noise: z.number().int(),
  findings: z.array(EvalActualFinding),
  error: z.string().nullish(),
  /** Skill evals only: which side of the with / without comparison this run is. */
  variant: z.enum(['with_skill', 'without_skill']).nullish(),
});
export type EvalActualOutput = z.infer<typeof EvalActualOutput>;

export const EvalLatestResult = z.object({
  pass: z.boolean(),
  ran_at: z.string(),
  /** null for a single-case run ("Run" on one row); set for "Run all evals". */
  batch_id: z.string().nullable(),
  /** Counts of that run, for the row subtitle ("got 1 · 1 on target"). */
  summary: z
    .object({ emitted: z.number().int(), kept: z.number().int(), hits: z.number().int(), noise: z.number().int(), error: z.string().nullable() })
    .nullable(),
});
export type EvalLatestResult = z.infer<typeof EvalLatestResult>;

export const EvalCaseRecord = z.object({
  id: z.string(),
  agent_id: z.string(),
  name: z.string(),
  expectation: EvalExpectation,
  input_diff: z.string(),
  source_finding_id: z.string().nullable(),
  source_pr_id: z.string().nullable(),
  created_at: z.string().nullable(),
  latest: EvalLatestResult.nullable(),
});
export type EvalCaseRecord = z.infer<typeof EvalCaseRecord>;

export const EvalCaseList = z.object({
  cases: z.array(EvalCaseRecord),
  passing: z.number().int(),
  with_runs: z.number().int(),
});
export type EvalCaseList = z.infer<typeof EvalCaseList>;

export const EvalMetrics = z.object({
  recall: z.number().min(0).max(1).nullable(),
  precision: z.number().min(0).max(1).nullable(),
  citation_accuracy: z.number().min(0).max(1).nullable(),
});
export type EvalMetrics = z.infer<typeof EvalMetrics>;

export const EvalBatchSummary = EvalMetrics.extend({
  batch_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  ran_at: z.string(),
  agent_version: z.number().int().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  cases_total: z.number().int(),
  cases_passed: z.number().int(),
  errors: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
});
export type EvalBatchSummary = z.infer<typeof EvalBatchSummary>;

export const EvalBatchCaseResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  case_name: z.string(),
  expectation: EvalExpectation,
  pass: z.boolean(),
  output: EvalActualOutput,
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalBatchCaseResult = z.infer<typeof EvalBatchCaseResult>;

export const EvalBatchDetail = z.object({
  summary: EvalBatchSummary,
  results: z.array(EvalBatchCaseResult),
});
export type EvalBatchDetail = z.infer<typeof EvalBatchDetail>;

export const EvalBatchList = z.object({ batches: z.array(EvalBatchSummary) });
export type EvalBatchList = z.infer<typeof EvalBatchList>;

export const EvalConfigSnapshot = z.object({
  agent_version: z.number().int().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  system_prompt: z.string().nullable(),
});
export type EvalConfigSnapshot = z.infer<typeof EvalConfigSnapshot>;

export const EvalCompareCase = z.object({
  case_id: z.string(),
  case_name: z.string(),
  kind: EvalExpectationKind,
  a: z.boolean().nullable(),
  b: z.boolean().nullable(),
});
export type EvalCompareCase = z.infer<typeof EvalCompareCase>;

export const EvalCompare = z.object({
  a: EvalBatchSummary,
  b: EvalBatchSummary,
  delta: z.object({
    recall: z.number().nullable(),
    precision: z.number().nullable(),
    citation_accuracy: z.number().nullable(),
    cost_usd: z.number().nullable(),
  }),
  config_a: EvalConfigSnapshot,
  config_b: EvalConfigSnapshot,
  cases: z.array(EvalCompareCase),
});
export type EvalCompare = z.infer<typeof EvalCompare>;

export const EvalImportResult = z.object({
  created: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
});
export type EvalImportResult = z.infer<typeof EvalImportResult>;

export const EvalOverviewAgent = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string(),
  model: z.string(),
  cases_total: z.number().int(),
  latest: EvalBatchSummary.nullable(),
  trend: z.array(EvalMetrics.extend({ ran_at: z.string() })),
});
export type EvalOverviewAgent = z.infer<typeof EvalOverviewAgent>;

export const EvalOverview = z.object({
  agents: z.array(EvalOverviewAgent),
  recent: z.array(EvalBatchSummary),
});
export type EvalOverview = z.infer<typeof EvalOverview>;

export const CompareQuery = z.object({ a: z.string().uuid(), b: z.string().uuid() });
export type CompareQuery = z.infer<typeof CompareQuery>;

/** What the "New eval case" modal is seeded with — nothing is stored yet. */
export const EvalCaseDraft = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string(),
  model: z.string(),
  name: z.string(),
  expectation: EvalExpectation,
  input_diff: z.string(),
  source_finding_id: z.string(),
  source_pr_id: z.string(),
});
export type EvalCaseDraft = z.infer<typeof EvalCaseDraft>;

/** Optional edits the user made in the modal; absent fields keep the seeded value. */
export const EvalCaseOverrides = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  expectation: EvalExpectation.optional(),
  input_diff: z.string().min(1).max(400_000).optional(),
});
export type EvalCaseOverrides = z.infer<typeof EvalCaseOverrides>;

/** "Run case": one agent run on a draft, scored in code, never stored. */
export const EvalTryInput = z.object({
  expectation: EvalExpectation,
  input_diff: z.string().min(1).max(400_000),
});
export type EvalTryInput = z.infer<typeof EvalTryInput>;

export const EvalTryResult = z.object({
  pass: z.boolean(),
  output: EvalActualOutput,
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  agent_version: z.number().int(),
  provider: z.string(),
  model: z.string(),
});
export type EvalTryResult = z.infer<typeof EvalTryResult>;

// ============================================================ Skill evals (optional feature)
// A skill is judged by running the SAME agent (the first one the skill is linked to) on the SAME
// diff twice: with only this skill, and with no skills. A case where the skill makes the difference
// is a skill that earns its tokens.

export const EvalVariantResult = z.object({
  pass: z.boolean(),
  summary: z
    .object({ emitted: z.number().int(), kept: z.number().int(), hits: z.number().int(), noise: z.number().int(), error: z.string().nullable() })
    .nullable(),
});
export type EvalVariantResult = z.infer<typeof EvalVariantResult>;

export const SkillEvalCaseRecord = z.object({
  id: z.string(),
  skill_id: z.string(),
  name: z.string(),
  expectation: EvalExpectation,
  input_diff: z.string(),
  created_at: z.string().nullable(),
  latest: z
    .object({ ran_at: z.string(), with_skill: EvalVariantResult.nullable(), without_skill: EvalVariantResult.nullable() })
    .nullable(),
});
export type SkillEvalCaseRecord = z.infer<typeof SkillEvalCaseRecord>;

export const SkillEvalCaseList = z.object({
  cases: z.array(SkillEvalCaseRecord),
  /** Cases whose latest run passes WITH the skill. */
  passing: z.number().int(),
  with_runs: z.number().int(),
});
export type SkillEvalCaseList = z.infer<typeof SkillEvalCaseList>;

/** A manually written case ("New eval case" on the Skills page). */
export const SkillEvalCaseInput = z.object({
  name: z.string().trim().min(1).max(120),
  expectation: EvalExpectation,
  input_diff: z.string().min(1).max(400_000),
});
export type SkillEvalCaseInput = z.infer<typeof SkillEvalCaseInput>;

export const SkillPairResult = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string(),
  model: z.string(),
  with_skill: EvalTryResult,
  without_skill: EvalTryResult,
});
export type SkillPairResult = z.infer<typeof SkillPairResult>;

export const SkillRunSummary = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string(),
  model: z.string(),
  total: z.number().int(),
  passing_with_skill: z.number().int(),
  passing_without_skill: z.number().int(),
  results: z.array(z.object({ case_id: z.string(), with_skill: EvalTryResult, without_skill: EvalTryResult })),
});
export type SkillRunSummary = z.infer<typeof SkillRunSummary>;
