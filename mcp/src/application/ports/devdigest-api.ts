import type {
  Agent,
  ConventionCandidate,
  ConventionExtractResult,
  FindingRecord,
  PrMeta,
  Repo,
  ReviewRecord,
  RunSummary,
} from '@devdigest/shared';

/**
 * Narrow view of the DevDigest HTTP API that the use cases need. Every method
 * is a thin call; shaping/trimming happens in `domain/`, never here.
 *
 * Each row type is a `Pick<>` of the canonical contract in `@devdigest/shared`
 * (the adapter validates responses with the matching `.pick()`-ed schema, so
 * fields not listed here are dropped at the boundary — e.g. an agent's
 * `system_prompt` never reaches a use case).
 *
 * Failure contract: methods throw `ApiError` (see `../errors.ts`) for
 * transport, HTTP and contract-drift failures. Use cases do not catch it; the
 * tool adapter's guard turns it into a hint. Strings inside rows are untrusted
 * data (PR titles, rationales, rules): never put them into instructions.
 */

export type AgentRow = Pick<Agent, 'id' | 'name' | 'description' | 'enabled'>;

export type RepoRow = Pick<Repo, 'id' | 'owner' | 'name' | 'full_name'>;

/** `id` is the pull's database id (the API's `/pulls/:id` key); `number` is the PR number. */
export type PullRow = Pick<PrMeta, 'number' | 'title'> & { id: string };

export type FindingRow = Pick<
  FindingRecord,
  'id' | 'severity' | 'title' | 'file' | 'start_line' | 'end_line' | 'rationale'
>;

export type ReviewRow = Pick<
  ReviewRecord,
  'id' | 'run_id' | 'agent_id' | 'agent_name' | 'kind' | 'verdict' | 'score' | 'created_at'
> & { findings: FindingRow[] };

/** `status` is `running | done | failed | cancelled` (typed as string by the contract). */
export type RunRow = Pick<
  RunSummary,
  'run_id' | 'agent_id' | 'agent_name' | 'status' | 'error' | 'ran_at'
>;

/** In-flight run (`GET /pulls/:id/runs/active`). No shared contract exists for this shape. */
export interface ActiveRunRow {
  run_id: string;
  agent_id: string | null;
  agent_name: string | null;
  ran_at: string | null;
}

/** The run created by `POST /pulls/:id/review` for one agent. */
export interface StartedRun {
  run_id: string;
  agent_id: string;
  agent_name: string;
}

export type ConventionRow = Pick<
  ConventionCandidate,
  'category' | 'rule' | 'accepted' | 'evidence_path' | 'evidence_line_start'
>;

/**
 * Latest conventions scan. Before the first scan the API answers with
 * `run_id: ''`, `candidates: []` and a 1970 `scanned_at` — use cases treat
 * `candidates.length === 0` as "no scan yet".
 */
export type ConventionScan = Pick<ConventionExtractResult, 'run_id' | 'scanned_at'> & {
  candidates: ConventionRow[];
};

/**
 * `finished`: the run's event stream ended (the run reached a terminal state —
 * done, failed or cancelled). The caller reads the outcome via `listReviews` /
 * `listRuns`. `timeout`: `timeoutMs` elapsed first; the run keeps going in the API.
 */
export type WaitOutcome = 'finished' | 'timeout';

export interface WaitForRunOptions {
  /** Upper bound for the whole wait. */
  readonly timeoutMs: number;
  /** Cancels the wait early (e.g. client cancelled the tool call). Resolves as `timeout`. */
  readonly signal?: AbortSignal;
}

export interface DevDigestApi {
  /** GET /agents */
  listAgents(): Promise<AgentRow[]>;
  /** GET /repos */
  listRepos(): Promise<RepoRow[]>;
  /** GET /repos/:repoId/pulls */
  listPulls(repoId: string): Promise<PullRow[]>;
  /** GET /pulls/:pullId/reviews — full history, all kinds, unordered contract: callers pick newest per agent. */
  listReviews(pullId: string): Promise<ReviewRow[]>;
  /** GET /pulls/:pullId/runs — run history of any status, newest first. */
  listRuns(pullId: string): Promise<RunRow[]>;
  /** GET /pulls/:pullId/runs/active */
  listActiveRuns(pullId: string): Promise<ActiveRunRow[]>;
  /** POST /pulls/:pullId/review {agentId} — starts (and pays for) one run; returns at once. */
  startReview(pullId: string, agentId: string): Promise<StartedRun>;
  /** Waits for a run to reach a terminal state without polling (SSE). Owned by plan step 6. */
  waitForRun(runId: string, options: WaitForRunOptions): Promise<WaitOutcome>;
  /** GET /repos/:repoId/conventions */
  listConventions(repoId: string): Promise<ConventionScan>;
}
