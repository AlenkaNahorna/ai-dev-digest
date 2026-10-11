/**
 * PR Brief — application use cases with fake ports (hermetic): exactly one
 * model call, no model call without files, the stored brief is touched only
 * after success, and the foreign-PR contract (`undefined`).
 */
import { describe, it, expect, vi } from 'vitest';
import type { PrBrief } from '@devdigest/shared';
import { createGenerateBrief } from '../src/modules/pr-brief/application/use-cases/generate-brief.js';
import { createGetBrief } from '../src/modules/pr-brief/application/use-cases/get-brief.js';
import { BriefError } from '../src/modules/pr-brief/application/errors.js';
import type {
  BriefFactsPort,
  BriefLogPort,
  BriefModelPort,
  BriefStorePort,
} from '../src/modules/pr-brief/application/ports/brief-ports.js';
import type { BriefFacts } from '../src/modules/pr-brief/domain/facts.js';
import type { ModelBriefOutput } from '../src/modules/pr-brief/domain/model-output.js';

const FACTS: BriefFacts = {
  title: 'Add limiter',
  description: 'body',
  files: [{ path: 'src/a.ts', additions: 3, deletions: 1, role: 'core' }],
  findings: [{ file: 'src/a.ts', line: 12, severity: 'WARNING', title: 'Unbounded loop' }],
  documents: [],
};
const MODEL_OUT: ModelBriefOutput = {
  summary: 'Adds a limiter.',
  risks: [{ kind: 'perf', title: 'Hot path', explanation: 'e', severity: 'medium', file_refs: ['src/a.ts', 'src/ghost.ts'] }],
  review_focus: [
    { file: 'src/a.ts', line: 12, reason: 'finding here' },
    { file: 'src/ghost.ts', line: 1, reason: 'invented' },
  ],
};
const OLD: PrBrief = {
  summary: 'old brief',
  risks: { risks: [] },
  review_focus: [],
  missing_inputs: [],
  partial: false,
};

function setup(over: { facts?: BriefFacts | undefined; model?: BriefModelPort['generate']; stored?: PrBrief | null } = {}) {
  const gather = vi.fn(async () => ('facts' in over ? over.facts : FACTS));
  const generate = vi.fn(over.model ?? (async () => MODEL_OUT));
  let stored: PrBrief | null = over.stored ?? null;
  const replace = vi.fn(async (_w: string, _p: string, b: PrBrief) => {
    stored = b;
  });
  const store: BriefStorePort = { get: async () => stored, replace };
  const log: BriefLogPort & { warn: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> } = { info: vi.fn(), warn: vi.fn() };
  const facts: BriefFactsPort = { gather };
  const run = createGenerateBrief({ facts, model: { generate }, store, log });
  return { run, gather, generate, replace, log, stored: () => stored };
}

describe('generate brief use case', () => {
  it('calls the model exactly once, stores the normalized brief and returns it (AC-15, AC-23)', async () => {
    const s = setup();
    const brief = await s.run('ws1', 'pr1');
    expect(s.generate).toHaveBeenCalledTimes(1);
    const bounded = s.generate.mock.calls[0]![2];
    expect(bounded.missing).toEqual(['intent', 'blast', 'documents']);
    expect(brief!.review_focus).toEqual([{ file: 'src/a.ts', line: 12, reason: 'finding here' }]);
    expect(brief!.risks.risks[0]!.file_refs).toEqual(['src/a.ts']);
    expect(brief!.missing_inputs).toEqual(['intent', 'blast', 'documents']);
    expect(s.replace).toHaveBeenCalledTimes(1);
    expect(s.replace).toHaveBeenCalledWith('ws1', 'pr1', brief);
  });

  it('only accepts references to files the model was shown: a file omitted by the 50-file cap is dropped', async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({
      path: `src/f${String(i).padStart(2, '0')}.ts`,
      additions: i + 1,
      deletions: 0,
      role: 'core' as const,
    }));
    const s = setup({
      facts: { ...FACTS, files: many, findings: [] },
      model: async () => ({
        summary: 's',
        risks: [{ kind: 'k', title: 'Cut file', explanation: 'e', severity: 'low' as const, file_refs: ['src/f00.ts'] }],
        review_focus: [
          { file: 'src/f00.ts', line: null, reason: 'omitted' },
          { file: 'src/f50.ts', line: null, reason: 'shown' },
        ],
      }),
    });
    const brief = await s.run('ws1', 'pr1');
    expect(brief!.risks.risks).toEqual([]);
    expect(brief!.review_focus.map((f) => f.file)).toEqual(['src/f50.ts']);
    expect(brief!.partial).toBe(true);
  });

  it('replaces an existing brief only after the new one succeeded (AC-23)', async () => {
    const s = setup({ stored: OLD });
    const brief = await s.run('ws1', 'pr1');
    expect(s.stored()).toEqual(brief);
    expect(s.stored()!.summary).toBe('Adds a limiter.');
  });

  it('does not call the model and reports files_unavailable when there is no changed file (AC-28a)', async () => {
    const s = setup({ facts: { ...FACTS, files: [] }, stored: OLD });
    await expect(s.run('ws1', 'pr1')).rejects.toMatchObject({ kind: 'files_unavailable' });
    expect(s.generate).not.toHaveBeenCalled();
    expect(s.replace).not.toHaveBeenCalled();
    expect(s.stored()).toEqual(OLD);
  });

  it('keeps the stored brief and throws model_failed when the model fails, without leaking provider text (AC-5)', async () => {
    const s = setup({
      stored: OLD,
      model: async () => {
        throw new Error('OpenAI 401: key sk-secret-123');
      },
    });
    const err = await s.run('ws1', 'pr1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BriefError);
    expect((err as BriefError).kind).toBe('model_failed');
    expect((err as BriefError).message).not.toContain('sk-secret');
    expect(s.replace).not.toHaveBeenCalled();
    expect(s.stored()).toEqual(OLD);
    expect(JSON.stringify(s.log.warn.mock.calls)).not.toContain('sk-secret');
  });

  it('returns undefined for a PR outside the workspace and calls nothing else (AC-30)', async () => {
    const s = setup({ facts: undefined });
    expect(await s.run('ws1', 'foreign')).toBeUndefined();
    expect(s.generate).not.toHaveBeenCalled();
    expect(s.replace).not.toHaveBeenCalled();
  });

  it('never logs the PR description or document text', async () => {
    const s = setup({
      facts: { ...FACTS, description: 'DESCRIPTION-SECRET', documents: [{ path: 'docs/a.md', text: 'DOC-SECRET', tokens: 2 }] },
    });
    await s.run('ws1', 'pr1');
    const logged = JSON.stringify([...s.log.info.mock.calls, ...s.log.warn.mock.calls]);
    expect(logged).not.toContain('DESCRIPTION-SECRET');
    expect(logged).not.toContain('DOC-SECRET');
  });
});

describe('get brief use case (AC-7, AC-30)', () => {
  it('passes the store answer through: brief, null (none yet) and undefined (foreign PR)', async () => {
    const get = vi.fn<BriefStorePort['get']>();
    const getBrief = createGetBrief({ store: { get, replace: vi.fn() } });
    get.mockResolvedValueOnce(OLD);
    expect(await getBrief('ws1', 'pr1')).toEqual(OLD);
    get.mockResolvedValueOnce(null);
    expect(await getBrief('ws1', 'pr1')).toBeNull();
    get.mockResolvedValueOnce(undefined);
    expect(await getBrief('ws1', 'pr1')).toBeUndefined();
  });
});
