import { createHash, randomUUID } from 'node:crypto';
import type { RunLogger } from './run-logger.js';
import { redactSecrets } from '../modules/reviews/intent/redact.js';

/**
 * Safe, structured logging of HOW a prompt was assembled — never WHAT is in it.
 *
 * Standard mode logs, per section: name, source identifier, length in chars and
 * estimated tokens; plus the chosen provider/model and a correlation id that
 * links the intent-classifier call and every review call of one batch.
 *
 * Verbose mode (local dev only, stdout only — see config.promptLogVerbose) adds
 * a content hash, line count and — for an ALLOWLIST of low-risk sections only —
 * a short redacted preview. Diffs, PR descriptions, issue/plan/spec bodies,
 * skills, callers and repo maps are NEVER previewed, in any mode.
 */

/** Sections whose (redacted, truncated) preview may appear in verbose mode. */
export const PREVIEW_ALLOWLIST: ReadonlySet<string> = new Set(['title', 'task', 'files']);
export const PREVIEW_MAX_CHARS = 160;

export interface PromptSectionInput {
  /** Section name, e.g. "diff", "pr_description", "plan". */
  section: string;
  /** Identifier of where it came from (path/ref/table) — never content. */
  source: string;
  /** Measured only; never emitted (except a redacted preview for allowlisted sections in verbose mode). */
  text: string | null | undefined;
}

export interface PromptSectionLog {
  section: string;
  source: string;
  chars: number;
  tokens_est: number;
}

export interface PromptLogContext {
  correlationId: string;
  call: 'intent' | 'review';
  provider: string;
  model: string;
  runId?: string;
  prId?: string;
  agent?: string;
  /** Map-reduce chunk label, when the review prompt is per file. */
  chunk?: string;
}

export interface PromptLogSummary {
  sections: PromptSectionLog[];
  total_chars: number;
  total_tokens_est: number;
}

export interface TokenCounter {
  count(text: string): number;
}

export function newCorrelationId(): string {
  return randomUUID();
}

/** Compute the loggable summary. Pure; contains no prompt text. */
export function summarizePrompt(inputs: PromptSectionInput[], tokenizer: TokenCounter): PromptLogSummary {
  const sections: PromptSectionLog[] = [];
  for (const i of inputs) {
    const text = i.text ?? '';
    if (text.length === 0) continue;
    sections.push({
      section: i.section,
      source: redactSecrets(i.source),
      chars: text.length,
      tokens_est: tokenizer.count(text),
    });
  }
  return {
    sections,
    total_chars: sections.reduce((n, s) => n + s.chars, 0),
    total_tokens_est: sections.reduce((n, s) => n + s.tokens_est, 0),
  };
}

/** Sections of the MAIN review prompt, from the assembled parts. Diff is measured, never emitted. */
export function reviewPromptInputs(
  a: {
    system: string;
    skills?: string | null;
    memory?: string | null;
    specs?: string | null;
    callers?: string | null;
    repo_map?: string | null;
    pr_description?: string | null;
    intent?: string | null;
  },
  diffText: string,
  task: string,
  agentName: string,
): PromptSectionInput[] {
  return [
    { section: 'system', source: `agent:${agentName}`, text: a.system },
    { section: 'task', source: 'pull_requests.title', text: task },
    { section: 'pr_description', source: 'pull_requests.body', text: a.pr_description },
    { section: 'intent', source: 'pr_intent', text: a.intent },
    { section: 'skills', source: 'agent_skills', text: a.skills },
    { section: 'memory', source: 'memory', text: a.memory },
    { section: 'repo_map', source: 'repo-intel', text: a.repo_map },
    { section: 'specs', source: 'project specs', text: a.specs },
    { section: 'callers', source: 'repo-intel', text: a.callers },
    { section: 'diff', source: 'pull_request diff', text: diffText },
  ];
}

function verboseDetails(inputs: PromptSectionInput[]) {
  return inputs
    .filter((i) => (i.text ?? '').length > 0)
    .map((i) => {
      const redacted = redactSecrets(i.text as string);
      return {
        section: i.section,
        lines: redacted.split('\n').length,
        // Hash of the REDACTED text: lets you see "did this section change between runs"
        // without revealing it.
        sha256_12: createHash('sha256').update(redacted).digest('hex').slice(0, 12),
        ...(PREVIEW_ALLOWLIST.has(i.section)
          ? { preview: redacted.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_MAX_CHARS) }
          : {}),
      };
    });
}

/**
 * Emit the structured prompt-assembly log.
 *  - always: ONE event (Live Log + stdout) with sizes/sources/model/correlation id;
 *  - verbose: ONE extra stdout-only event with hashes + allowlisted previews.
 */
export function logPrompt(
  log: RunLogger,
  ctx: PromptLogContext,
  inputs: PromptSectionInput[],
  tokenizer: TokenCounter,
  verbose: boolean,
): PromptLogSummary {
  const summary = summarizePrompt(inputs, tokenizer);
  const meta = {
    correlation_id: ctx.correlationId,
    call: ctx.call,
    provider: ctx.provider,
    model: ctx.model,
    ...(ctx.runId ? { run_id: ctx.runId } : {}),
    ...(ctx.prId ? { pr_id: ctx.prId } : {}),
    ...(ctx.agent ? { agent: ctx.agent } : {}),
    ...(ctx.chunk ? { chunk: ctx.chunk } : {}),
  };
  log.info(
    `[prompt] ${ctx.call} → ${ctx.provider}/${ctx.model}: ${summary.sections.length} section(s), ` +
      `${summary.total_chars} chars, ~${summary.total_tokens_est} tokens (corr=${ctx.correlationId.slice(0, 8)})`,
    { event: 'prompt.assembled', ...meta, ...summary },
  );
  if (verbose) {
    log.local(`[prompt:verbose] ${ctx.call} (corr=${ctx.correlationId.slice(0, 8)})`, {
      event: 'prompt.assembled.verbose',
      ...meta,
      sections: verboseDetails(inputs),
    });
  }
  return summary;
}
