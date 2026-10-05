import { clipText } from '../domain/text.js';

/** Sink for diagnostics. In the server this writes to stderr, never stdout. */
export type Log = (message: string) => void;

/**
 * An error whose `message` is safe to show to the model: it says what is wrong
 * and what to do next. Use cases throw this for expected, user-fixable
 * problems (unknown agent, repo not added, ...).
 */
export class HintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HintError';
  }
}

export type ApiErrorKind = 'unreachable' | 'timeout' | 'http' | 'contract';

export interface ApiErrorInfo {
  /** Base URL the adapter talks to (operator configuration, not user input). */
  readonly baseUrl: string;
  /** HTTP status, when the API answered. */
  readonly status?: number;
  /** `error.code` from the API envelope, or a synthetic code (`timeout`, `contract_mismatch`). */
  readonly code?: string;
  /** `error.message` from the API envelope or a short description. Untrusted. */
  readonly apiMessage?: string;
  /** Extra diagnostics for stderr only (never shown to the model). */
  readonly detail?: string;
}

/** Failure to get a usable answer from the DevDigest API. Thrown by the outbound adapter. */
export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly info: ApiErrorInfo,
  ) {
    super(`${kind}: ${info.code ?? info.status ?? ''} ${info.apiMessage ?? ''}`.trim());
    this.name = 'ApiError';
  }
}

const API_MESSAGE_MAX = 200;

function describeApiError(err: ApiError): string {
  const { kind, info } = err;
  if (kind === 'unreachable') {
    return `DevDigest API is not reachable at ${info.baseUrl}. Ask the user to run ./scripts/dev.sh. Do not retry.`;
  }
  if (info.status === 429) {
    return 'Review rate limit reached (10/min). Wait a minute before calling run_agent_on_pr again.';
  }
  const code = info.code ?? (info.status !== undefined ? String(info.status) : 'unknown');
  const message = clipText(info.apiMessage ?? 'request failed', API_MESSAGE_MAX);
  return `DevDigest API error ${code}: ${message}`;
}

const GENERIC_MESSAGE =
  'devdigest-mcp hit an unexpected internal error (details are in the server log on stderr). Do not retry.';

/**
 * Map any thrown value to a message that is safe to hand to the model. Known
 * errors keep their hint; everything else becomes a short generic message and
 * the detail (incl. stack) goes to `log` only.
 */
export function toHintMessage(error: unknown, log: Log): string {
  if (error instanceof HintError) return error.message;
  if (error instanceof ApiError) {
    if (error.info.detail !== undefined) log(`${error.message} — ${error.info.detail}`);
    return describeApiError(error);
  }
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  log(`unexpected error: ${detail}`);
  return GENERIC_MESSAGE;
}

export type Guarded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

/** Run `fn`; never throws. Failures become `{ok:false, message}` via `toHintMessage`. */
export async function guarded<T>(fn: () => Promise<T>, log: Log): Promise<Guarded<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, message: toHintMessage(error, log) };
  }
}
