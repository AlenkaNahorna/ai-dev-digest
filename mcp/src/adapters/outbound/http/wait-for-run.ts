import { ApiErrorBody } from '@devdigest/shared';
import { ApiError } from '../../../application/errors.js';
import type { WaitForRunOptions, WaitOutcome } from '../../../application/ports/devdigest-api.js';

/** What the wait implementation needs from the HTTP adapter. */
export interface WaitForRunDeps {
  /** API base URL without a trailing slash. */
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
}

const MAX_ERROR_BODY_CHARS = 20_000;

/**
 * Waits for a run to reach a terminal state on `GET /runs/:id/events` (SSE).
 *
 * Wire protocol (server/src/modules/reviews/adapters/inbound/http/routes.ts,
 * fastify-sse-v2): the server replays the buffered events, streams live ones as
 * `id/event/data` frames and CLOSES the response when the run completes
 * (`runBus.onDone`). There is no dedicated "done" frame, so the end of the
 * stream IS the completion signal. The route is exempt from rate limiting.
 *
 * Because frames carry no completion information, their payloads are never
 * interpreted: chunks are read and discarded, which keeps memory constant no
 * matter what the (untrusted) stream contains. The caller reads the outcome
 * from `listReviews` / `listRuns` afterwards.
 *
 * Resolves `timeout` when `timeoutMs` elapses or `signal` aborts; the connection
 * is always closed and the timer cleared. Throws `ApiError` when the API is
 * unreachable, answers with an error status, or answers with something that is
 * not an event stream.
 */
export async function waitForRunEvents(
  deps: WaitForRunDeps,
  runId: string,
  options: WaitForRunOptions,
): Promise<WaitOutcome> {
  const { timeoutMs, signal } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive finite number');
  }
  if (signal?.aborted === true) return 'timeout';

  const path = `/runs/${encodeURIComponent(runId)}/events`;
  const controller = new AbortController();
  let stopped = false;
  let wake: () => void = () => undefined;
  const stopSignal = new Promise<'stopped'>((resolve) => {
    wake = () => resolve('stopped');
  });
  const stop = (): void => {
    stopped = true;
    controller.abort();
    wake();
  };
  const timer = setTimeout(stop, timeoutMs);
  signal?.addEventListener('abort', stop, { once: true });

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    let res: Response;
    try {
      res = await Promise.race([
        deps.fetch(`${deps.baseUrl}${path}`, {
          method: 'GET',
          headers: { accept: 'text/event-stream' },
          signal: controller.signal,
        }),
        stopSignal,
      ]).then((r) => {
        if (r === 'stopped') throw new StoppedError();
        return r;
      });
    } catch (error) {
      if (stopped || error instanceof StoppedError) return 'timeout';
      const detail = error instanceof Error ? error.message : String(error);
      throw new ApiError('unreachable', { baseUrl: deps.baseUrl, detail: `GET ${path}: ${detail}` });
    }

    if (!res.ok) throw await httpError(deps.baseUrl, path, res);

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('text/event-stream') || res.body === null) {
      throw new ApiError('contract', {
        baseUrl: deps.baseUrl,
        status: res.status,
        code: 'contract_mismatch',
        apiMessage: `GET ${path} did not return an event stream`,
      });
    }

    reader = res.body.getReader();
    for (;;) {
      let chunk: Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>> | 'stopped';
      try {
        chunk = await Promise.race([reader.read(), stopSignal]);
      } catch (error) {
        if (stopped) return 'timeout';
        const detail = error instanceof Error ? error.message : String(error);
        throw new ApiError('unreachable', {
          baseUrl: deps.baseUrl,
          detail: `GET ${path}: stream broke: ${detail}`,
        });
      }
      if (chunk === 'stopped') return 'timeout';
      if (chunk.done) return 'finished';
      // Payload deliberately ignored (see doc comment).
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    if (!controller.signal.aborted) controller.abort();
    if (reader !== undefined) void reader.cancel().catch(() => undefined);
  }
}

class StoppedError extends Error {}

async function httpError(baseUrl: string, path: string, res: Response): Promise<ApiError> {
  let code = `http_${res.status}`;
  let message = res.statusText || 'request failed';
  try {
    const text = (await res.text()).slice(0, MAX_ERROR_BODY_CHARS);
    const envelope = ApiErrorBody.safeParse(JSON.parse(text));
    if (envelope.success) {
      code = envelope.data.error.code;
      message = envelope.data.error.message;
    }
  } catch {
    // non-JSON error body: keep the status-based fallback
  }
  return new ApiError('http', {
    baseUrl,
    status: res.status,
    code,
    apiMessage: message,
    detail: `GET ${path}`,
  });
}
