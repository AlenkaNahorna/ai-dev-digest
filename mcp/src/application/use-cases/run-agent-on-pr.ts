import { shapeReview } from '../../domain/review-shape.js';
import type { ShapedReview } from '../../domain/review-shape.js';
import { clipText } from '../../domain/text.js';
import { DEFAULT_WAIT_MS } from '../../domain/wait-budget.js';
import { HintError } from '../errors.js';
import type { DevDigestApi } from '../ports/devdigest-api.js';
import type { Resolver } from './resolve.js';

export interface RunAgentOnPrInput {
  readonly repo: string;
  readonly pr: number;
  readonly agent: string;
}

export interface StillRunning {
  run_id: string;
  status: 'running';
  hint: string;
}

export type RunAgentOnPrOutput = ShapedReview | StillRunning;

export interface RunAgentOnPrOptions {
  /** Blocking limit in ms (`DEVDIGEST_MCP_WAIT_MS`). Default 120 000. */
  readonly waitMs?: number;
}

type RunApi = Pick<
  DevDigestApi,
  'listActiveRuns' | 'startReview' | 'waitForRun' | 'listReviews' | 'listRuns'
>;

const STILL_RUNNING_HINT = 'Still running. Call get_findings for this PR in ~30s.';
const ERROR_MAX = 200;

function stillRunning(runId: string): StillRunning {
  return { run_id: runId, status: 'running', hint: STILL_RUNNING_HINT };
}

/**
 * `run_agent_on_pr`: the only tool that starts (and pays for) a run.
 *
 * Flow: resolve ids -> attach to a run of this agent that is already in flight
 * (never start a second paid run) or start one -> wait on the event stream up to
 * `waitMs` -> read the review with that run id. Request count is constant
 * (no polling): resolution + active + start + one SSE connection + one
 * reviews read (+ one runs read when the review is missing).
 */
export function createRunAgentOnPr(
  api: RunApi,
  resolver: Pick<Resolver, 'resolvePull' | 'resolveAgent'>,
  options: RunAgentOnPrOptions = {},
): (input: RunAgentOnPrInput) => Promise<RunAgentOnPrOutput> {
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  return async (input) => {
    const { pull } = await resolver.resolvePull(input.repo, input.pr);
    const agent = await resolver.resolveAgent(input.agent);

    const active = await api.listActiveRuns(pull.id);
    const inFlight = active.find((r) => r.agent_id === agent.id);
    const runId = inFlight?.run_id ?? (await api.startReview(pull.id, agent.id)).run_id;

    const outcome = await api.waitForRun(runId, { timeoutMs: waitMs });
    if (outcome === 'timeout') return stillRunning(runId);

    const reviews = await api.listReviews(pull.id);
    const review = reviews.find((r) => r.run_id === runId && r.kind === 'review');
    if (review !== undefined) return shapeReview(review);

    const runs = await api.listRuns(pull.id);
    const run = runs.find((r) => r.run_id === runId);
    const id = clipText(runId, 64);
    if (run?.status === 'failed') {
      const reason = clipText(run.error ?? 'unknown error', ERROR_MAX);
      throw new HintError(
        `Run ${id} failed: ${reason}. Call run_agent_on_pr again or pick another agent.`,
      );
    }
    if (run?.status === 'cancelled') {
      throw new HintError(
        `Run ${id} was cancelled. Call run_agent_on_pr again or pick another agent.`,
      );
    }
    // The stream can end early (API restarted, connection dropped): the run may still be going.
    if (run?.status === 'running') return stillRunning(runId);
    throw new HintError(
      `Run ${id} finished but no review was saved. Call get_findings for this PR, or call run_agent_on_pr again.`,
    );
  };
}
