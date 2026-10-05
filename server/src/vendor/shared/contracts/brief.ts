import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
export const IntentConfidence = z.enum(['high', 'medium', 'low']);
export type IntentConfidence = z.infer<typeof IntentConfidence>;

/** Where a piece of the intent came from (identifiers only — never bodies). */
export const IntentSourceKind = z.enum([
  'title',
  'description',
  'issue',
  'plan',
  'spec',
  'files',
  'commits',
]);
export type IntentSourceKind = z.infer<typeof IntentSourceKind>;

export const IntentSource = z.object({
  kind: IntentSourceKind,
  /** Stable identifier, e.g. "issue#12", "docs/plans/x.md@abc1234", "notion.so". */
  ref: z.string(),
  /** false → the material was referenced but could not be fetched. */
  resolved: z.boolean(),
});
export type IntentSource = z.infer<typeof IntentSource>;

/** What the cheap classifier model returns (LLM structured output). */
export const IntentClassification = z.object({
  summary: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  confidence: IntentConfidence,
  /** Context the classifier wanted but did not have (unavailable links, empty body…). */
  missing_context: z.array(z.string()),
});
export type IntentClassification = z.infer<typeof IntentClassification>;

/** The persisted / injected intent: classification + provenance. */
export const Intent = z.object({
  summary: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  confidence: IntentConfidence.default('medium'),
  sources: z.array(IntentSource).default([]),
  missing_context: z.array(z.string()).default([]),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

/** Why blast data is partial or missing. Mirrors repo-intel `DegradedReason`. */
export const BlastDegradedReason = z.enum([
  'flag_off',
  'index_failed',
  'index_partial',
  'repo_too_large',
  'no_data',
]);
export type BlastDegradedReason = z.infer<typeof BlastDegradedReason>;

/** An earlier PR of the same repo that touched some of the files this PR changes. */
export const PriorPr = z.object({
  number: z.number().int(),
  title: z.string(),
  status: z.string(),
  /** How many of this PR's changed files the earlier PR also touched. */
  shared_files: z.number().int().nonnegative(),
});
export type PriorPr = z.infer<typeof PriorPr>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
  /** Optional so older payloads (and `PrBrief.blast`) keep parsing. */
  degraded: z.boolean().optional(),
  degraded_reason: BlastDegradedReason.optional(),
  /** Earlier PRs that touched the same files (newest first, capped). Absent when none or no data. */
  prior_prs: z.array(PriorPr).optional(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;
