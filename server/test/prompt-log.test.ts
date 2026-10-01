import { describe, expect, it } from 'vitest';
import { RunBus } from '../src/platform/sse.js';
import { RunLogger } from '../src/platform/run-logger.js';
import { logPrompt, newCorrelationId, reviewPromptInputs, summarizePrompt } from '../src/platform/prompt-log.js';

const tokenizer = { count: (t: string) => Math.ceil(t.length / 4) };
const SECRET = 'sk-abcdefghijklmnopqrstuvwxyz0123456789';
const DIFF = '+const veryPrivateDiffLine = 1;';
const SPEC = 'PRIVATE-SPEC-BODY do not leak';

function capture() {
  const lines: { obj: Record<string, unknown>; msg: string }[] = [];
  const pino = {
    info: (obj: Record<string, unknown>, msg: string) => lines.push({ obj, msg }),
    warn: (obj: Record<string, unknown>, msg: string) => lines.push({ obj, msg }),
    error: (obj: Record<string, unknown>, msg: string) => lines.push({ obj, msg }),
    debug: (obj: Record<string, unknown>, msg: string) => lines.push({ obj, msg }),
  };
  const corr = newCorrelationId();
  const log = new RunLogger(new RunBus(), ['r1'], pino as never, { correlationId: corr });
  return { lines, log, corr };
}

const inputs = () =>
  reviewPromptInputs(
    { system: 'sys', specs: SPEC, pr_description: `desc ${SECRET}`, intent: 'intent text' },
    DIFF,
    `Review PR "title ${SECRET}"`,
    'agent-x',
  );

describe('prompt-log', () => {
  it('reports section name, source, chars, tokens; skips empty sections', () => {
    const s = summarizePrompt(inputs(), tokenizer);
    const diff = s.sections.find((x) => x.section === 'diff')!;
    expect(diff).toMatchObject({ source: 'pull_request diff', chars: DIFF.length });
    expect(s.sections.find((x) => x.section === 'callers')).toBeUndefined();
    expect(s.total_chars).toBe(s.sections.reduce((n, x) => n + x.chars, 0));
  });

  it('standard mode: model + correlation id present, no content anywhere', () => {
    const { lines, log, corr } = capture();
    logPrompt(log, { correlationId: corr, call: 'review', provider: 'openai', model: 'gpt-x', runId: 'r1' }, inputs(), tokenizer, false);
    const all = JSON.stringify(lines);
    expect(all).toContain(corr);
    expect(all).toContain('gpt-x');
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain('veryPrivateDiffLine');
    expect(all).not.toContain('PRIVATE-SPEC-BODY');
    expect(all).not.toContain('preview');
  });

  it('verbose mode: hashes + redacted previews for allowlisted sections only, stdout only', () => {
    const { lines, log, corr } = capture();
    const bus = (log as unknown as { bus: RunBus }).bus;
    logPrompt(log, { correlationId: corr, call: 'review', provider: 'openai', model: 'gpt-x', runId: 'r1' }, inputs(), tokenizer, true);
    const all = JSON.stringify(lines);
    expect(all).toContain('sha256_12');
    expect(all).toContain('preview'); // task
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain('veryPrivateDiffLine');
    expect(all).not.toContain('PRIVATE-SPEC-BODY');
    expect(all).not.toContain('desc '); // pr_description is never previewed
    // verbose line is not published to the run bus (UI / persisted trace)
    expect(JSON.stringify(bus.buffer('r1'))).not.toContain('sha256_12');
  });
});
