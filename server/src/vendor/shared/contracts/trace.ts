import { z } from 'zod';

/**
 * Run trace. The ENTIRE trace of one run is persisted as a SINGLE
 * jsonb document in `run_traces` (not per-row). Live events stream via SSE
 * during the run; the full log is written once on completion.
 */

export const RunEventKind = z.enum(['info', 'tool', 'result', 'error']);
export type RunEventKind = z.infer<typeof RunEventKind>;

/** A single live-log line. `t` = elapsed timestamp string (e.g. "00.31"). */
export const RunLogLine = z.object({
  t: z.string(),
  kind: RunEventKind,
  msg: z.string(),
});
export type RunLogLine = z.infer<typeof RunLogLine>;

/** SSE payload streamed on `/runs/:id/events`. */
export const RunEvent = z.object({
  runId: z.string(),
  seq: z.number().int(),
  kind: RunEventKind,
  msg: z.string(),
  t: z.string(),
  data: z.unknown().optional(),
});
export type RunEvent = z.infer<typeof RunEvent>;

export const ToolCall = z.object({
  tool: z.string(),
  args: z.string(),
  meta: z.string().nullish(),
  ms: z.number().int(),
});
export type ToolCall = z.infer<typeof ToolCall>;

export const PromptAssembly = z.object({
  system: z.string(),
  skills: z.string().nullish(),
  memory: z.string().nullish(),
  specs: z.string().nullish(),
  /** Callers-of-changed-symbols digest (T1.3); null when absent. */
  callers: z.string().nullish(),
  /** Repo skeleton / map (T3); null when absent. Enables per-slot token
      attribution in the run trace. */
  repo_map: z.string().nullish(),
  /** PR author's description/body (truncated); null when absent. */
  pr_description: z.string().nullish(),
  /** Structured PR intent block injected into the review prompt; null when absent. */
  intent: z.string().nullish(),
  user: z.string(),
});
export type PromptAssembly = z.infer<typeof PromptAssembly>;

/**
 * The intent-classifier call, recorded SEPARATELY from the main review call.
 * Sizes and identifiers only — never prompt text, diff bodies or secrets.
 */
export const IntentCallTrace = z.object({
  provider: z.string(),
  model: z.string(),
  /** Reused persisted intent (same head_sha) — no LLM call was made. */
  cached: z.boolean(),
  /** Characters per prompt component (title, description, issue, plan_docs, files, hunk_headers, commits). */
  components: z.record(z.string(), z.number()),
  tokens_est: z.number().int(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int(),
  confidence: z.string().nullish(),
  sources: z.array(z.object({ kind: z.string(), ref: z.string(), resolved: z.boolean() })),
});
export type IntentCallTrace = z.infer<typeof IntentCallTrace>;

export const MemoryPulled = z.object({
  pr: z.number().int().nullish(),
  text: z.string(),
});
export type MemoryPulled = z.infer<typeof MemoryPulled>;

export const RunStats = z.object({
  duration_ms: z.number().int(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  /** Actual/estimated LLM cost; null when unknown. */
  cost_usd: z.number().nullable(),
  findings: z.number().int(),
  grounding: z.string(),
});
export type RunStats = z.infer<typeof RunStats>;

/**
 * One decision of a post-model gate on a finding — what the grounding gate (a
 * finding must cite lines inside a real diff hunk) or the intent-scope filter
 * kept or dropped, and why. Titles/locations only: no prompt or diff text.
 */
export const GroundingDecision = z.object({
  gate: z.enum(['grounding', 'scope']),
  kept: z.boolean(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  /** Why it was dropped; absent for kept findings. */
  reason: z.string().nullish(),
});
export type GroundingDecision = z.infer<typeof GroundingDecision>;

/** The single-document trace stored in `run_traces.trace`. */
export const RunTrace = z.object({
  /**
   * Telemetry schema version (D5, AC-55). Optional on read so pre-versioned
   * traces still parse; defaults to 1 when absent.
   */
  schema_version: z.literal(1).optional(),
  config: z.object({
    agent: z.string(),
    version: z.string().nullish(),
    provider: z.string().nullish(),
    model: z.string(),
    pr: z.number().int().nullish(),
    source: z.enum(['local', 'ci']).default('local'),
    /** Ties this run to its log lines (intent call + review calls share one id per batch). */
    correlation_id: z.string().nullish(),
  }),
  stats: RunStats,
  prompt_assembly: PromptAssembly,
  tool_calls: z.array(ToolCall),
  raw_output: z.string(),
  memory_pulled: z.array(MemoryPulled),
  specs_read: z.array(z.string()),
  /** Per-document token counts of the injected project-context docs, in prompt order. */
  specs_detail: z.array(z.object({ path: z.string(), tokens: z.number().int() })).nullish(),
  /** Token count of the whole injected `## Project context` block (heading + delimiters). */
  specs_block_tokens: z.number().int().nullish(),
  /** Separate intent-classifier call (cheap model); absent on runs without one. */
  intent_call: IntentCallTrace.nullish(),
  /**
   * Every finding the model produced and what the gates decided (kept / dropped
   * + reason). Optional so traces written before this field still parse.
   */
  grounding_detail: z.array(GroundingDecision).nullish(),
  log: z.array(RunLogLine),
});
export type RunTrace = z.infer<typeof RunTrace>;

/**
 * One row of a PR's run history (every agent_runs row, any status). Surfaced on
 * the PR page so runs — including FAILED ones with their error — survive reload.
 */
export const RunSummary = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.string().nullable(), // running | done | failed | cancelled
  error: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  /** Actual/estimated LLM cost; null when unknown (e.g. failed before an LLM call). */
  cost_usd: z.number().nullable(),
  findings_count: z.number().int().nullable(),
  grounding: z.string().nullable(),
  ran_at: z.string().nullable(),
  // Review outcome, denormalized onto the run row at completion (the timeline
  // has no FK to the review). score = the review's 0-100 score; blockers =
  // findings that trip the agent's gate. Null on failed/cancelled runs.
  score: z.number().int().nullable(),
  blockers: z.number().int().nullable(),
});
export type RunSummary = z.infer<typeof RunSummary>;
