import { z } from 'zod';
import {
  Agent,
  ApiErrorBody,
  BlastRadius,
  ConventionCandidate,
  ConventionExtractResult,
  FindingRecord,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
  RunSummary,
} from '@devdigest/shared';
import { ApiError } from '../../../application/errors.js';
import type {
  DevDigestApi,
  StartedRun,
  WaitForRunOptions,
  WaitOutcome,
} from '../../../application/ports/devdigest-api.js';
import { waitForRunEvents } from './wait-for-run.js';

// ---- Boundary schemas: `.pick()` of the canonical contracts ------------------
// Unknown keys are stripped (zod default), so heavy/sensitive fields such as an
// agent's `system_prompt` never leave this file. A contract drift (missing or
// retyped field) fails loudly in `request()` instead of producing garbage.

const AgentRowSchema = Agent.pick({ id: true, name: true, description: true, model: true, enabled: true });
const RepoRowSchema = Repo.pick({ id: true, owner: true, name: true, full_name: true });
const PullRowSchema = PrMeta.pick({ id: true, number: true, title: true }).extend({
  id: z.string(), // nullish in the contract; a pull we can address always has one
});
const FindingRowSchema = FindingRecord.pick({
  id: true,
  severity: true,
  title: true,
  file: true,
  start_line: true,
  end_line: true,
  rationale: true,
});
const ReviewRowSchema = ReviewRecord.pick({
  id: true,
  run_id: true,
  agent_id: true,
  agent_name: true,
  kind: true,
  verdict: true,
  score: true,
  created_at: true,
}).extend({ findings: z.array(FindingRowSchema) });
const RunRowSchema = RunSummary.pick({
  run_id: true,
  agent_id: true,
  agent_name: true,
  status: true,
  error: true,
  ran_at: true,
});
const ActiveRunRowSchema = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  ran_at: z.string().nullable(),
});
const ConventionRowSchema = ConventionCandidate.pick({
  category: true,
  rule: true,
  accepted: true,
  evidence_path: true,
  evidence_line_start: true,
});
const ConventionScanSchema = ConventionExtractResult.pick({
  run_id: true,
  scanned_at: true,
}).extend({ candidates: z.array(ConventionRowSchema) });
const StartReviewResponseSchema = ReviewRunResponse.pick({ runs: true });

// ---- Adapter -----------------------------------------------------------------

export interface HttpApiOptions {
  /** e.g. `http://127.0.0.1:3001` (a trailing slash is tolerated). */
  readonly baseUrl: string;
  /** Per-request timeout in ms. Default 10 000. Does not apply to `waitForRun`. */
  readonly requestTimeoutMs?: number;
  /** Injected for hermetic tests; defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BODY_CHARS = 10_000_000;

/** Validates the configured base URL and strips trailing slashes. Throws on bad config. */
export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`DEVDIGEST_API_URL is not a valid URL: ${JSON.stringify(raw)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`DEVDIGEST_API_URL must be http(s), got ${url.protocol}`);
  }
  return url.toString().replace(/\/+$/, '');
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export function createHttpDevDigestApi(options: HttpApiOptions): DevDigestApi {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetch ?? globalThis.fetch;
  const id = encodeURIComponent;

  async function request<S extends z.ZodTypeAny>(
    method: 'GET' | 'POST',
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<z.infer<S>> {
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (isTimeout(error)) {
        throw new ApiError('timeout', {
          baseUrl,
          code: 'timeout',
          apiMessage: `no response from ${baseUrl} within ${timeoutMs} ms`,
          detail: `${method} ${path}: ${detail}`,
        });
      }
      throw new ApiError('unreachable', { baseUrl, detail: `${method} ${path}: ${detail}` });
    }

    const text = await res.text();
    if (text.length > MAX_BODY_CHARS) {
      throw new ApiError('contract', {
        baseUrl,
        status: res.status,
        code: 'contract_mismatch',
        apiMessage: `response too large for ${method} ${path}`,
      });
    }

    if (!res.ok) {
      let code = `http_${res.status}`;
      let message = res.statusText || 'request failed';
      try {
        const envelope = ApiErrorBody.safeParse(JSON.parse(text));
        if (envelope.success) {
          code = envelope.data.error.code;
          message = envelope.data.error.message;
        }
      } catch {
        // non-JSON error body: keep the status-based fallback
      }
      throw new ApiError('http', { baseUrl, status: res.status, code, apiMessage: message });
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApiError('contract', {
        baseUrl,
        status: res.status,
        code: 'contract_mismatch',
        apiMessage: `response of ${method} ${path} is not JSON`,
      });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError('contract', {
        baseUrl,
        status: res.status,
        code: 'contract_mismatch',
        apiMessage: `unexpected response shape from ${method} ${path}`,
        detail: parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; '),
      });
    }
    return parsed.data as z.infer<S>;
  }

  return {
    listAgents: () => request('GET', '/agents', z.array(AgentRowSchema)),
    listRepos: () => request('GET', '/repos', z.array(RepoRowSchema)),
    listPulls: (repoId) => request('GET', `/repos/${id(repoId)}/pulls`, z.array(PullRowSchema)),
    listReviews: (pullId) =>
      request('GET', `/pulls/${id(pullId)}/reviews`, z.array(ReviewRowSchema)),
    listRuns: (pullId) => request('GET', `/pulls/${id(pullId)}/runs`, z.array(RunRowSchema)),
    listActiveRuns: (pullId) =>
      request('GET', `/pulls/${id(pullId)}/runs/active`, z.array(ActiveRunRowSchema)),
    async startReview(pullId, agentId): Promise<StartedRun> {
      const { runs } = await request(
        'POST',
        `/pulls/${id(pullId)}/review`,
        StartReviewResponseSchema,
        { agentId },
      );
      const [run] = runs;
      if (run === undefined || runs.length !== 1) {
        throw new ApiError('contract', {
          baseUrl,
          code: 'contract_mismatch',
          apiMessage: `expected exactly one run from POST /pulls/:id/review, got ${runs.length}`,
        });
      }
      return run;
    },
    waitForRun: (runId: string, opts: WaitForRunOptions): Promise<WaitOutcome> =>
      waitForRunEvents({ baseUrl, fetch: doFetch }, runId, opts),
    listConventions: (repoId) =>
      request('GET', `/repos/${id(repoId)}/conventions`, ConventionScanSchema),
    getBlastRadius: (pullId) => request('GET', `/pulls/${id(pullId)}/blast`, BlastRadius),
  };
}
