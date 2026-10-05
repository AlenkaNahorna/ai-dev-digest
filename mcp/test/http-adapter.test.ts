import { describe, expect, it, vi } from 'vitest';
import { createHttpDevDigestApi, normalizeBaseUrl } from '../src/adapters/outbound/http/devdigest-api.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(respond: (url: string, init?: RequestInit) => Response, baseUrl = 'http://localhost:3001/') {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchStub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ...(init !== undefined ? { init } : {}) });
    return respond(url, init);
  });
  const api = createHttpDevDigestApi({ baseUrl, fetch: fetchStub as unknown as typeof fetch });
  return { api, calls };
}

describe('http adapter', () => {
  it('strips fields outside the picked schemas (no system_prompt leaves the adapter)', async () => {
    const { api, calls } = setup(() =>
      json([
        {
          id: 'a1',
          name: 'Security',
          description: 'Finds vulns',
          enabled: true,
          system_prompt: 'TOP SECRET PROMPT',
          provider: 'openai',
          model: 'gpt',
          output_schema: {},
          version: 3,
        },
      ]),
    );
    const agents = await api.listAgents();
    expect(agents).toEqual([{ id: 'a1', name: 'Security', description: 'Finds vulns', model: 'gpt', enabled: true }]);
    expect(JSON.stringify(agents)).not.toContain('SECRET');
    expect(calls[0]?.url).toBe('http://localhost:3001/agents');
  });

  it('reads the blast radius incl. the degraded flag, and encodes the id', async () => {
    const body = {
      changed_symbols: [{ name: 'a', file: 'a.ts', kind: 'function' }],
      downstream: [{ symbol: 'a', callers: [{ name: 'c', file: 'b.ts', line: 3 }], endpoints_affected: ['GET /x'], crons_affected: [] }],
      summary: '1 symbols · 1 callers · 1 endpoints · 0 crons',
      degraded: true,
      degraded_reason: 'no_data',
      extra: 'dropped',
    };
    const { api, calls } = setup(() => json(body));
    const out = await api.getBlastRadius('p/1');
    expect(calls[0]?.url).toBe('http://localhost:3001/pulls/p%2F1/blast');
    expect(out.degraded).toBe(true);
    expect(out.degraded_reason).toBe('no_data');
    expect(out.downstream[0]?.callers).toEqual([{ name: 'c', file: 'b.ts', line: 3 }]);
    expect(out).not.toHaveProperty('extra');
  });

  it('fails with a contract error when the blast response lacks downstream', async () => {
    const { api } = setup(() => json({ changed_symbols: [], summary: 's' }));
    await expect(api.getBlastRadius('p1')).rejects.toMatchObject({ kind: 'contract' });
  });

  it('maps a 404 envelope on the blast route to an http error', async () => {
    const { api } = setup(() => json({ error: { code: 'not_found', message: 'Pull request not found' } }, 404));
    await expect(api.getBlastRadius('p1')).rejects.toMatchObject({ kind: 'http', info: { status: 404 } });
  });

  it('percent-encodes ids placed in paths', async () => {
    const { api, calls } = setup(() => json([]));
    await api.listPulls('a/b?x=1');
    expect(calls[0]?.url).toBe('http://localhost:3001/repos/a%2Fb%3Fx%3D1/pulls');
  });

  it('requires an id on pulls and keeps number/title', async () => {
    const { api } = setup(() => json([{ id: 'p1', number: 482, title: 'Add retries', author: 'x' }]));
    expect(await api.listPulls('r1')).toEqual([{ id: 'p1', number: 482, title: 'Add retries' }]);
    const { api: bad } = setup(() => json([{ id: null, number: 1, title: 't' }]));
    await expect(bad.listPulls('r1')).rejects.toMatchObject({ kind: 'contract' });
  });

  it('posts {agentId} and returns the single started run', async () => {
    const { api, calls } = setup(() =>
      json({ pr_id: 'p1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'Security' }], reviews: [] }),
    );
    expect(await api.startReview('p1', 'a1')).toEqual({ run_id: 'run1', agent_id: 'a1', agent_name: 'Security' });
    expect(calls[0]?.url).toBe('http://localhost:3001/pulls/p1/review');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe('{"agentId":"a1"}');
  });

  it('rejects a start response with no run', async () => {
    const { api } = setup(() => json({ pr_id: 'p1', runs: [], reviews: [] }));
    await expect(api.startReview('p1', 'a1')).rejects.toMatchObject({ kind: 'contract' });
  });

  it('parses reviews, runs, active runs and conventions', async () => {
    const review = {
      id: 'rv1',
      pr_id: 'p1',
      agent_id: 'a1',
      run_id: 'run1',
      agent_name: 'Security',
      kind: 'review',
      verdict: 'comment',
      summary: 'long summary',
      score: 80,
      model: 'm',
      created_at: '2026-10-01T00:00:00Z',
      findings: [
        {
          id: 'f1',
          review_id: 'rv1',
          severity: 'WARNING',
          category: 'bug',
          title: 'T',
          file: 'a.ts',
          start_line: 3,
          end_line: 4,
          rationale: 'why',
          suggestion: 'drop me',
          confidence: 0.9,
          accepted_at: null,
          dismissed_at: null,
        },
      ],
    };
    const run = { run_id: 'run1', agent_id: 'a1', agent_name: 'Security', status: 'done', error: null, ran_at: null, provider: 'x', model: 'm', duration_ms: 1, tokens_in: 1, tokens_out: 1, cost_usd: 0, findings_count: 1, grounding: null, score: 80, blockers: 0 };
    const scan = {
      run_id: 'scan1',
      scanned_at: '2026-10-02T00:00:00Z',
      sample_files_count: 2,
      candidates: [
        { id: 'c1', repo_id: 'r1', run_id: 'scan1', category: 'naming', rule: 'Use camelCase', evidence_path: 'src/a.ts', evidence_line_start: 3, evidence_line_end: 5, evidence_snippet: 'x', confidence: 0.8, accepted: true, created_at: 'now' },
      ],
    };
    const { api } = setup((url) => {
      if (url.endsWith('/reviews')) return json([review]);
      if (url.endsWith('/runs/active')) return json([{ run_id: 'run2', agent_id: 'a1', agent_name: 'Security', ran_at: null }]);
      if (url.endsWith('/runs')) return json([run]);
      return json(scan);
    });
    const reviews = await api.listReviews('p1');
    expect(reviews[0]?.findings[0]).toEqual({ id: 'f1', severity: 'WARNING', title: 'T', file: 'a.ts', start_line: 3, end_line: 4, rationale: 'why' });
    expect(reviews[0]).not.toHaveProperty('summary');
    expect(await api.listRuns('p1')).toEqual([{ run_id: 'run1', agent_id: 'a1', agent_name: 'Security', status: 'done', error: null, ran_at: null }]);
    expect(await api.listActiveRuns('p1')).toHaveLength(1);
    const conventions = await api.listConventions('r1');
    expect(conventions.candidates[0]).toEqual({ category: 'naming', rule: 'Use camelCase', accepted: true, evidence_path: 'src/a.ts', evidence_line_start: 3 });
    expect(conventions.run_id).toBe('scan1');
  });

  describe('waitForRun (SSE)', () => {
    const enc = new TextEncoder();

    /** SSE response stub; `hang` keeps the stream open until the request is aborted. */
    function sse(opts: { chunks?: string[]; hang?: boolean; status?: number; contentType?: string; body?: string }) {
      const respond = (_url: string, init?: RequestInit): Response => {
        if (opts.status !== undefined && opts.status >= 400) {
          return new Response(opts.body ?? '', { status: opts.status });
        }
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of opts.chunks ?? []) controller.enqueue(enc.encode(chunk));
            if (opts.hang !== true) controller.close();
            init?.signal?.addEventListener('abort', () =>
              controller.error(new DOMException('aborted', 'AbortError')),
            );
          },
        });
        return new Response(body, {
          status: 200,
          headers: { 'content-type': opts.contentType ?? 'text/event-stream; charset=utf-8' },
        });
      };
      return { respond };
    }

    it('finishes when the server closes the stream, after replaying frames', async () => {
      const { respond } = sse({
        chunks: ['retry: 3000\n\n', 'id: 1\nevent: info\ndata: {"runId":"run1","seq":1}\n\n', 'id: 2\nevent: result\ndata: {}\n\n'],
      });
      const { api, calls } = setup(respond);
      await expect(api.waitForRun('run1', { timeoutMs: 5000 })).resolves.toBe('finished');
      expect(calls[0]?.url).toBe('http://localhost:3001/runs/run1/events');
      expect(new Headers(calls[0]?.init?.headers).get('accept')).toBe('text/event-stream');
    });

    it('finishes immediately for a stream that only replays and ends (already completed run)', async () => {
      const { respond } = sse({ chunks: [] });
      const { api } = setup(respond);
      await expect(api.waitForRun('run1', { timeoutMs: 5000 })).resolves.toBe('finished');
    });

    it('returns timeout when the run outlives the limit and aborts the connection', async () => {
      const { respond } = sse({ chunks: ['id: 1\nevent: info\ndata: {}\n\n'], hang: true });
      const { api, calls } = setup(respond);
      await expect(api.waitForRun('run1', { timeoutMs: 40 })).resolves.toBe('timeout');
      expect(calls[0]?.init?.signal?.aborted).toBe(true);
    });

    it('returns timeout when the signal aborts, even if fetch ignores the signal', async () => {
      const never = vi.fn(() => new Promise<Response>(() => undefined));
      const api = createHttpDevDigestApi({ baseUrl: 'http://x', fetch: never as unknown as typeof fetch });
      const ctrl = new AbortController();
      const pending = api.waitForRun('run1', { timeoutMs: 60_000, signal: ctrl.signal });
      setTimeout(() => ctrl.abort(), 10);
      await expect(pending).resolves.toBe('timeout');
    });

    it('returns timeout without any request when the signal is already aborted', async () => {
      const { api, calls } = setup(() => json([]));
      const ctrl = new AbortController();
      ctrl.abort();
      await expect(api.waitForRun('run1', { timeoutMs: 1000, signal: ctrl.signal })).resolves.toBe('timeout');
      expect(calls).toHaveLength(0);
    });

    it('leaves no timer or abort listener behind', async () => {
      vi.useFakeTimers();
      try {
        const { respond } = sse({ chunks: ['id: 1\ndata: {}\n\n'] });
        const { api } = setup(respond);
        const ctrl = new AbortController();
        const addSpy = vi.spyOn(ctrl.signal, 'removeEventListener');
        await expect(api.waitForRun('run1', { timeoutMs: 120_000, signal: ctrl.signal })).resolves.toBe('finished');
        expect(vi.getTimerCount()).toBe(0);
        expect(addSpy).toHaveBeenCalledWith('abort', expect.any(Function));
      } finally {
        vi.useRealTimers();
      }
    });

    it('tolerates malformed, oversized and binary frames (payloads are never interpreted)', async () => {
      const huge = `data: ${'x'.repeat(2_000_000)}\n\n`;
      const { respond } = sse({
        chunks: ['data: {not json\n\n', ': comment only\n\n', '\u0000\u0001garbage', huge, 'event: error\ndata: {"kind":"error"}\n\n'],
      });
      const { api } = setup(respond);
      await expect(api.waitForRun('run1', { timeoutMs: 5000 })).resolves.toBe('finished');
    });

    it('treats a non-stream 200 response as a contract error, not as completion', async () => {
      const { api } = setup(() => json({ ok: true }));
      await expect(api.waitForRun('run1', { timeoutMs: 1000 })).rejects.toMatchObject({ kind: 'contract' });
    });

    it('maps the error envelope of a failing stream request (unknown run)', async () => {
      const { respond } = sse({
        status: 404,
        body: JSON.stringify({ error: { code: 'not_found', message: 'Run not found', details: null } }),
      });
      const { api } = setup(respond);
      await expect(api.waitForRun('nope', { timeoutMs: 1000 })).rejects.toMatchObject({
        kind: 'http',
        info: { status: 404, code: 'not_found' },
      });
    });

    it('maps a refused connection to unreachable', async () => {
      const failing = vi.fn(async () => {
        throw new TypeError('fetch failed');
      });
      const api = createHttpDevDigestApi({ baseUrl: 'http://x', fetch: failing as unknown as typeof fetch });
      await expect(api.waitForRun('run1', { timeoutMs: 1000 })).rejects.toMatchObject({ kind: 'unreachable' });
    });

    it('percent-encodes the run id', async () => {
      const { respond } = sse({});
      const { api, calls } = setup(respond);
      await api.waitForRun('a/b?c', { timeoutMs: 1000 });
      expect(calls[0]?.url).toBe('http://localhost:3001/runs/a%2Fb%3Fc/events');
    });

    it('rejects a non-positive timeout', async () => {
      const { api } = setup(() => json([]));
      await expect(api.waitForRun('run1', { timeoutMs: 0 })).rejects.toThrow(RangeError);
    });
  });

  it('validates the configured base URL', () => {
    expect(normalizeBaseUrl('http://localhost:3001///')).toBe('http://localhost:3001');
    expect(() => normalizeBaseUrl('not a url')).toThrow(/not a valid URL/);
    expect(() => normalizeBaseUrl('file:///etc/passwd')).toThrow(/http/);
  });
});
