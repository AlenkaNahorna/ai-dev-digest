import { describe, it, expect } from 'vitest';
import type { UnifiedDiff } from '@devdigest/shared';

import { IntentService, intentInputHash } from '../src/modules/reviews/intent/service.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';

const SECRET = 'sk_live_51Habcdef1234567890';
const PLAN = 'PLAN-BODY-Step-one-add-middleware';
const DIFF_BODY_LINE = 'stripeKey: "sk_live_xxx"';

const diff: UnifiedDiff = {
  raw: `diff --git a/src/config.ts b/src/config.ts\n@@ -10,3 +10,4 @@\n+  ${DIFF_BODY_LINE}`,
  files: [
    {
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      hunks: [{ file: 'src/config.ts', oldStart: 10, oldLines: 3, newStart: 10, newLines: 4, section: 'export const config', newLineNumbers: [11] }],
    },
  ],
};

const pull = {
  id: 'pr1',
  number: 482,
  title: 'Add rate limiting',
  body: `Adds limiter. key ${SECRET}. Plan: docs/plans/rl.md, spec https://notion.so/team/spec`,
  headSha: 'a1b2c3d4e5f6',
} as never;
const repoRow = { owner: 'acme', name: 'payments-api' } as never;

function setup(existing?: unknown) {
  const llm = new MockLLMProvider('openai', {
    structured: {
      summary: 'Add rate limiting to public endpoints',
      in_scope: ['limiter middleware'],
      out_of_scope: ['auth changes'],
      confidence: 'high',
      missing_context: [],
    },
  });
  const upserts: unknown[] = [];
  const repo = {
    getIntentRow: async () => existing,
    getPrFiles: async () => [],
    getPrCommits: async () => [],
    upsertIntent: async (...a: unknown[]) => void upserts.push(a),
  };
  const container = {
    config: { promptLogVerbose: false },
    tokenizer: { count: (t: string) => Math.ceil(t.length / 4) },
    llm: async () => llm,
    github: async () => ({ getIssue: async () => { throw new Error('none'); } }),
    git: { readFile: async () => PLAN },
  };
  const logs: { msg: string; data?: unknown }[] = [];
  const log = {
    correlationId: 'intent-test-correlation-id',
    info: (msg: string, data?: unknown) => void logs.push({ msg, data }),
    result: (msg: string, data?: unknown) => void logs.push({ msg, data }),
    error: (msg: string, data?: unknown) => void logs.push({ msg, data }),
    step: async (label: string, fn: () => Promise<unknown>) => {
      logs.push({ msg: label });
      return fn();
    },
  };
  const svc = new IntentService(container as never, repo as never, (async () => ({
    provider: 'openrouter',
    model: 'test/flash-classifier',
  })) as never);
  return { svc, llm, upserts, logs, log };
}

describe('IntentService.ensure', () => {
  it('calls the cheap classifier model separately, with headers only, plan included, secrets redacted', async () => {
    const { svc, llm, upserts, logs, log } = setup();
    const r = await svc.ensure({ workspaceId: 'w', pull, repoRow, diff, log: log as never });

    const call = llm.calls.find((c) => c.method === 'completeStructured')!.req as {
      model: string;
      schemaName: string;
      messages: { content: string }[];
    };
    expect(call.model).toBe('test/flash-classifier');
    expect(call.schemaName).toBe('IntentClassification');
    const prompt = call.messages.map((m) => m.content).join('\n');
    expect(prompt).toContain(PLAN); // linked plan is used
    expect(prompt).toContain('@@ -10,3 +10,4 @@ export const config'); // hunk header
    expect(prompt).not.toContain(DIFF_BODY_LINE); // no change bodies
    expect(prompt).not.toContain(SECRET); // secrets redacted
    expect(prompt).toContain('notion.so/team/spec'); // unavailable link surfaced

    // Deterministic post-processing: unresolved spec caps confidence + is listed.
    expect(r.intent.confidence).toBe('medium');
    expect(r.intent.missing_context.join(' ')).toContain('notion.so/team/spec');
    expect(r.intent.sources).toContainEqual({ kind: 'plan', ref: 'docs/plans/rl.md@a1b2c3d', resolved: true });
    expect(upserts).toHaveLength(1);
    expect(r.call.cached).toBe(false);
    expect(r.call.model).toBe('test/flash-classifier');

    // Log: components + model + token estimate + sources — no secrets, plan text or diff bodies.
    const logged = JSON.stringify(logs);
    expect(logged).toContain('test/flash-classifier');
    expect(logged).toContain('tokens_est');
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(PLAN);
    expect(logged).not.toContain(DIFF_BODY_LINE);
  });

  it('reuses the persisted intent for the same head_sha (no LLM call) and re-derives on force', async () => {
    const existing = {
      intent: 's',
      inScope: [],
      outOfScope: [],
      confidence: 'low',
      sources: [],
      missingContext: [],
      provider: 'openrouter',
      model: 'test/flash-classifier',
      headSha: 'a1b2c3d4e5f6',
      inputHash: intentInputHash(pull as never),
      tokensIn: 1,
      tokensOut: 1,
      costUsd: 0,
    };
    const a = setup(existing);
    const cached = await a.svc.ensure({ workspaceId: 'w', pull, repoRow, diff, log: a.log as never });
    expect(cached.call.cached).toBe(true);
    expect(a.llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);

    // Editing only the PR description (same head_sha) invalidates the cache.
    const edited = { ...(pull as object), body: 'a completely different description' } as never;
    const c = setup(existing);
    await c.svc.ensure({ workspaceId: 'w', pull: edited, repoRow, diff, log: c.log as never });
    expect(c.llm.calls.filter((x) => x.method === 'completeStructured')).toHaveLength(1);

    const b = setup(existing);
    await b.svc.ensure({ workspaceId: 'w', pull, repoRow, diff, log: b.log as never, force: true });
    expect(b.llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
  });
});
