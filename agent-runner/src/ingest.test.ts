import { describe, it, expect } from 'vitest';
import { CiResultArtifact } from '@devdigest/shared';
import { postIngest } from './ingest.js';
import { buildResultArtifact, eventToVerdict } from './artifact.js';
import type { FetchLike } from './github.js';
import type { Finding } from '@devdigest/shared';

/**
 * Hermetic tests for the runner's ingest POST step (AC-15) and the extended
 * result artifact's now-required `repository`/`verdict` fields (AC-16). No
 * network, no reviewer-core — `postIngest` and `buildResultArtifact` are both
 * dependency-light, so these load even when reviewer-core's optional deps are
 * absent in the sandbox. The orchestration wiring (skip-when-no-artifact) is in
 * `run.test.ts`.
 */

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function recorder(status = 200): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body as string,
    });
    return new Response('{}', { status });
  }) as unknown as FetchLike;
  return { fetchImpl, calls };
}

const ARTIFACT: CiResultArtifact = {
  findings_count: 1,
  critical: 1,
  warning: 0,
  suggestion: 0,
  cost_usd: 0.002,
  duration_ms: 500,
  agent: 'Security Reviewer',
  version: '1',
  pr_number: 42,
  repository: 'acme/widgets',
  verdict: 'request_changes',
  commit_sha: 'deadbeef',
  run_id: '777',
  run_attempt: 1,
};

describe('postIngest (AC-15)', () => {
  it('POSTs the artifact to /ci/ingest with a credentialed Authorization header', async () => {
    const { fetchImpl, calls } = recorder(200);
    const secret = 'opaque-ingest-value';
    const result = await postIngest('https://studio.example.com/', secret, ARTIFACT, fetchImpl);

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    // Trailing slash on the base URL is normalised; path is /ci/ingest.
    expect(call.url).toBe('https://studio.example.com/ci/ingest');
    expect(call.method).toBe('POST');
    expect(call.headers.Authorization).toBe(`Bearer ${secret}`);
    expect(call.headers['Content-Type']).toBe('application/json');
    // The artifact round-trips through the body and still parses the contract.
    const sent = JSON.parse(call.body);
    expect(CiResultArtifact.safeParse(sent).success).toBe(true);
    expect(sent.repository).toBe('acme/widgets');
    expect(sent.verdict).toBe('request_changes');
  });

  it('reports a non-2xx response as not-ok without throwing (best-effort side channel)', async () => {
    const { fetchImpl } = recorder(500);
    const result = await postIngest('https://studio.example.com', 'v', ARTIFACT, fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it('reports a network failure as not-ok without throwing', async () => {
    const boom = (async () => {
      throw new Error('network down');
    }) as unknown as FetchLike;
    const result = await postIngest('https://studio.example.com', 'v', ARTIFACT, boom);
    expect(result.ok).toBe(false);
    expect(result.status).toBeNull();
    expect(result.error).toMatch(/network down/);
  });
});

describe('buildResultArtifact (AC-16 — repository/verdict required)', () => {
  const findings: Finding[] = [
    {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'secret',
      file: 'a.ts',
      start_line: 1,
      end_line: 1,
      rationale: 'r',
      confidence: 0.9,
      kind: 'finding',
    },
  ];

  it('embeds the matching fields the server ingest dedupes on, and passes the shared contract', () => {
    const artifact = buildResultArtifact({
      findings,
      costUsd: 0.01,
      durationMs: 10,
      agent: 'A',
      prNumber: 9,
      verdict: eventToVerdict('REQUEST_CHANGES'),
      repository: 'acme/widgets',
      commitSha: 'sha1',
      runId: '55',
      runAttempt: 2,
    });

    expect(artifact.repository).toBe('acme/widgets');
    expect(artifact.verdict).toBe('request_changes');
    expect(artifact.commit_sha).toBe('sha1');
    expect(artifact.run_id).toBe('55');
    expect(artifact.run_attempt).toBe(2);
    expect(artifact.critical).toBe(1);
    expect(CiResultArtifact.safeParse(artifact).success).toBe(true);
  });

  it('eventToVerdict lower-cases each event (AC-10)', () => {
    expect(eventToVerdict('APPROVE')).toBe('approve');
    expect(eventToVerdict('REQUEST_CHANGES')).toBe('request_changes');
    expect(eventToVerdict('COMMENT')).toBe('comment');
  });
});
