import type { Container } from '../../platform/container.js';
import type {
  FindingActionKind,
  MultiAgentEstimate,
  MultiAgentRun,
  RunEventKind,
  RunTrace,
  SmartDiffResponse,
} from '@devdigest/shared';
import { AppError, ForbiddenError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { ReviewRepository } from './adapters/outbound/persistence/repository.js';
import { type ReviewDto, type ReviewDtoFinding } from './helpers.js';
import { RunLogger } from '../../platform/run-logger.js';
import { newCorrelationId } from '../../platform/prompt-log.js';
import { IntentService } from './intent/service.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { reviewToDto } from './helpers.js';
import { buildSmartDiff, latestReviewFindings } from './smart-diff/build-smart-diff.js';
import { buildMultiAgentRun } from './multi-agent/build-results.js';
import {
  ESTIMATE_SAMPLE_SIZE,
  MAX_AGENTS,
  MIN_AGENTS,
  MULTI_AGENT_POOL_SIZE,
} from './multi-agent/constants.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over container.runBus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */
export class ReviewService {
  private repo: ReviewRepository;
  private agents: Container['agentsRepo'];
  private executor: ReviewRunExecutor;
  private intents: IntentService;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.agents = container.agentsRepo;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
    this.intents = new IntentService(container, this.repo);
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run. `all` → all enabled agents; else a single agent.
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean },
  ): Promise<AgentRow[]> {
    if (opts.all) return this.agents.listEnabled(workspaceId);
    if (opts.agentId) {
      const agent = await this.agents.getById(workspaceId, opts.agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      return [agent];
    }
    throw new AppError('invalid_run_request', 'Provide agentId or all:true', 400);
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.repo.deleteReview(workspaceId, reviewId);
  }

  /** In-flight runs for a PR (server-side source of truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.repo.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string) {
    return this.repo.listRunsForPull(workspaceId, prId);
  }

  /** Delete one run from the history (+ its trace). */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    return this.repo.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Signals a live runner to stop at its next
   * checkpoint AND marks the DB row cancelled + completes the bus immediately —
   * so cancel also works for ORPHANED runs (whose background process died on a
   * server restart) where signalling alone would do nothing.
   */
  async ensureRunAccess(workspaceId: string, runId: string): Promise<void> {
    if (!(await this.repo.runExistsInWorkspace(workspaceId, runId))) {
      throw new NotFoundError('Run not found');
    }
  }

  async cancelRun(workspaceId: string, runId: string): Promise<void> {
    await this.ensureRunAccess(workspaceId, runId);
    this.publish(runId, 'info', 'Cancellation requested — stopping…');
    this.container.runBus.cancel(runId);
    await this.repo.cancelRunIfRunning(workspaceId, runId);
    this.container.runBus.complete(runId);
  }

  /** Reap runs left 'running' by a previous (now-dead) process. Called on boot. */
  async reapStaleRuns(): Promise<number> {
    return this.repo.reapStaleRunningRuns();
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
  ): Promise<{ runs: { run_id: string; agent_id: string; agent_name: string }[]; reviews: ReviewDto[] }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Create the agent_run rows up front so a runId is available IMMEDIATELY —
    // the client persists these in global state and subscribes to the SSE
    // stream. The actual (slow) review runs in the background below.
    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Fire-and-forget: the HTTP response returns now with the runIds; reviews
    // are persisted as each agent finishes and the client refetches on SSE done.
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error({ prId, err: (err as Error).message }, 'review: background execution crashed');
    });

    return { runs, reviews: [] };
  }

  // ===========================================================================
  // Multi-agent review (one parent, N linked agent_runs)
  // ===========================================================================

  /**
   * Start one multi-agent review: resolve the requested agents (must exist in
   * the workspace), create a parent `multi_agent_runs` row + N linked
   * `agent_runs`, and kick off the executor with a small concurrency pool (D2).
   * Rejects a second start while a run on the PR is already active → 409.
   */
  async startMultiAgentRun(
    workspaceId: string,
    prId: string,
    agentIds: string[],
    logger?: Logger,
  ): Promise<{ parent_id: string; runs: { run_id: string; agent_id: string; agent_name: string }[] }> {
    if (agentIds.length < MIN_AGENTS || agentIds.length > MAX_AGENTS) {
      throw new AppError('invalid_run_request', `Select between ${MIN_AGENTS} and ${MAX_AGENTS} agents`, 422);
    }
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // 409 guard: reject while any run on this PR is still active (reuses the
    // 'running' source of truth — see plan 409 note; no 'queued' state today).
    const active = await this.repo.activeRunsForPull(workspaceId, prId);
    if (active.length > 0) {
      throw new AppError('multi_agent_run_active', 'A review is already running on this pull request', 409);
    }

    // Resolve + validate every requested agent up front. `getById` is
    // workspace-scoped, so a miss means the agent is not in the caller's
    // workspace → 403 (spec AC-53/D11), never 404 (the PR was already found).
    const targets: AgentRow[] = [];
    for (const id of agentIds) {
      const agent = await this.agents.getById(workspaceId, id);
      if (!agent) throw new ForbiddenError(`Agent not accessible: ${id}`);
      targets.push(agent);
    }

    const parentId = await this.repo.createMultiAgentRun({ workspaceId, prId });
    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
        multiAgentRunId: parentId,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    void this.executor
      .executeRuns(workspaceId, pull, repo, jobs, logger, { concurrency: MULTI_AGENT_POOL_SIZE })
      .catch((err) => {
        logger?.error({ prId, parentId, err: (err as Error).message }, 'multi-agent: background execution crashed');
      });

    return { parent_id: parentId, runs };
  }

  /**
   * Read-model for a multi-agent review: load the parent (by id) + all its runs
   * with the newest review + findings, then compute columns, status, totals,
   * groups and conflicts on read. Cross-workspace parent → 403 (D11).
   */
  async getMultiAgentRun(workspaceId: string, parentId: string): Promise<MultiAgentRun> {
    const parent = await this.repo.getMultiAgentParent(workspaceId, parentId);
    if (!parent) throw new ForbiddenError('Multi-agent review not accessible');
    const rows = await this.repo.runsForMultiAgentParent(workspaceId, parentId);
    return buildMultiAgentRun(parent, rows);
  }

  /**
   * Pre-run estimate: per requested agent, mean duration + cost of its last
   * `ESTIMATE_SAMPLE_SIZE` done, source='local' runs workspace-wide (D8).
   * `sample_size<1` → nulls (the UI marks it unavailable).
   */
  async estimateMultiAgent(workspaceId: string, agentIds: string[]): Promise<MultiAgentEstimate> {
    const unique = [...new Set(agentIds)];
    const rows = await this.repo.estimateForAgents(workspaceId, unique, ESTIMATE_SAMPLE_SIZE);
    return {
      estimates: rows.map((r) => ({
        agent_id: r.agentId,
        mean_duration_ms: r.sampleSize > 0 ? r.meanDurationMs : null,
        mean_cost_usd: r.sampleSize > 0 ? r.meanCostUsd : null,
        sample_size: r.sampleSize,
      })),
    };
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.container.runBus.publish(runId, kind, msg, data);
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
  ): Promise<{ finding: ReviewDtoFinding }> {
    return actOnFindingImpl(this.repo, workspaceId, findingId, action);
  }

  // ===========================================================================
  // Intent (separate cheap-model classifier)
  // ===========================================================================

  getIntent(workspaceId: string, prId: string) {
    return this.intents.get(workspaceId, prId);
  }

  /** Re-derive the intent after the PR changed (user-triggered). */
  rederiveIntent(workspaceId: string, prId: string, logger?: Logger) {
    return this.intents.rederive(workspaceId, prId, new RunLogger(this.container.runBus, [], logger, { prId, correlationId: newCorrelationId() }));
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async reviewsForPull(workspaceId: string, prId: string): Promise<ReviewDto[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.repo.reviewsForPull(prId);
    const names = new Map<string, string>();
    for (const { review } of rows) {
      if (review.agentId && !names.has(review.agentId)) {
        const a = await this.agents.getById(workspaceId, review.agentId);
        if (a) names.set(review.agentId, a.name);
      }
    }
    return rows.map(({ review, findings }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null),
    );
  }

  /**
   * Smart Diff: PR files grouped by role + finding lines from the newest review
   * per agent. Pure DB read; never calls the LLM.
   */
  async smartDiffForPull(workspaceId: string, prId: string): Promise<SmartDiffResponse> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const [files, rows] = await Promise.all([this.repo.getPrFiles(prId), this.repo.reviewsForPull(prId)]);
    const findings = latestReviewFindings(
      rows.map(({ review, findings: fs }) => ({
        id: review.id,
        agent_id: review.agentId,
        created_at: review.createdAt,
        findings: fs.map((f) => ({ file: f.file, start_line: f.startLine })),
      })),
    );
    return buildSmartDiff(files, findings);
  }

  async getRunTrace(workspaceId: string, runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(workspaceId, runId);
  }
}
