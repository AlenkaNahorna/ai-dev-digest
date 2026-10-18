import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../../../../../db/client.js';
import * as t from '../../../../../db/schema.js';
import type { RunSummary, RunTrace } from '@devdigest/shared';
import type { AgentRunRow, FindingRow } from '../../../../../db/rows.js';

// ---- in-flight / history --------------------------------------------------

/** In-flight runs for a PR (status='running' or 'queued') — the server-side
 *  source of truth for "which agents are running now". 'queued' only exists for
 *  multi-agent runs waiting for a free pool slot. Joined with the agent name. */
export async function activeRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; ran_at: string | null }[]> {
  const rows = await db
    .select({
      id: t.agentRuns.id,
      agentId: t.agentRuns.agentId,
      ranAt: t.agentRuns.ranAt,
      agentName: t.agents.name,
    })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.prId, prId),
        inArray(t.agentRuns.status, ['running', 'queued']),
      ),
    );
  return rows.map((r) => ({
    run_id: r.id,
    agent_id: r.agentId,
    agent_name: r.agentName ?? null,
    ran_at: r.ranAt ? r.ranAt.toISOString() : null,
  }));
}

/** Whether a run belongs to the caller's workspace. */
export async function runExistsInWorkspace(
  db: Db,
  workspaceId: string,
  runId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: t.agentRuns.id })
    .from(t.agentRuns)
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.workspaceId, workspaceId)));
  return Boolean(row);
}

/** All runs for a PR (any status), newest first — the PR run history. */
export async function listRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<RunSummary[]> {
  const rows = await db
    .select({ run: t.agentRuns, agentName: t.agents.name })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.prId, prId)))
    .orderBy(desc(t.agentRuns.ranAt));
  return rows.map(({ run, agentName }) => ({
    run_id: run.id,
    agent_id: run.agentId,
    agent_name: agentName ?? null,
    provider: run.provider,
    model: run.model,
    status: run.status,
    error: run.error,
    duration_ms: run.durationMs,
    tokens_in: run.tokensIn,
    tokens_out: run.tokensOut,
    cost_usd: run.costUsd,
    findings_count: run.findingsCount,
    grounding: run.grounding,
    ran_at: run.ranAt ? run.ranAt.toISOString() : null,
    score: run.score,
    blockers: run.blockers,
  }));
}

/**
 * Delete one agent run (+ its trace via FK cascade) AND the review it produced.
 * Workspace-scoped. `reviews.run_id` has no FK to `agent_runs`, so the review
 * (and its findings, which DO cascade from `reviews`) must be removed explicitly
 * here — otherwise deleting a run from the timeline leaves its findings orphaned
 * in the Review Runs list below.
 */
export async function deleteAgentRun(
  db: Db,
  workspaceId: string,
  runId: string,
): Promise<boolean> {
  await db
    .delete(t.reviews)
    .where(and(eq(t.reviews.runId, runId), eq(t.reviews.workspaceId, workspaceId)));
  const rows = await db
    .delete(t.agentRuns)
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.workspaceId, workspaceId)))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** Mark a still-running (or still-queued) run as cancelled (no-op if it already finished). */
export async function cancelRunIfRunning(
  db: Db,
  workspaceId: string,
  runId: string,
): Promise<boolean> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(t.agentRuns.id, runId),
        eq(t.agentRuns.workspaceId, workspaceId),
        inArray(t.agentRuns.status, ['running', 'queued']),
      ),
    )
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** On boot: any run still 'running' or 'queued' is orphaned (its process died /
 *  restarted), so mark it failed. Prevents permanently stuck runs in the UI. */
export async function reapStaleRunningRuns(db: Db): Promise<number> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'failed' })
    .where(inArray(t.agentRuns.status, ['running', 'queued']))
    .returning({ id: t.agentRuns.id });
  return rows.length;
}

// ---- observability: agent_runs + run_traces -------------------------------

/** Create an agent_runs row (`running` by default, `queued` for multi-agent runs
 *  that wait for a pool slot); returns its id (= the runId). */
export async function createAgentRun(
  db: Db,
  values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
    /** Parent multi-agent review this run belongs to; null for single-agent runs. */
    multiAgentRunId?: string | null;
    /** Initial status. Multi-agent runs start 'queued' and flip to 'running' when their job starts. */
    status?: 'running' | 'queued';
  },
): Promise<string> {
  const [row] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId: values.workspaceId,
      agentId: values.agentId,
      prId: values.prId,
      provider: values.provider,
      model: values.model,
      multiAgentRunId: values.multiAgentRunId ?? null,
      status: values.status ?? 'running',
      source: 'local',
    })
    .returning({ id: t.agentRuns.id });
  return row!.id;
}

/** Create the parent `multi_agent_runs` row; returns its id. */
export async function createMultiAgentRun(
  db: Db,
  values: { workspaceId: string; prId: string },
): Promise<string> {
  const [row] = await db
    .insert(t.multiAgentRuns)
    .values({ workspaceId: values.workspaceId, prId: values.prId })
    .returning({ id: t.multiAgentRuns.id });
  return row!.id;
}

/**
 * A pool worker is about to execute this run. A 'queued' row becomes 'running'
 * and its `ran_at` is reset to the real start time, so the parent's wall-clock
 * (max(ran_at + duration) - parent.ran_at) includes the time spent queued.
 *   'started'         the row was queued and is now running
 *   'already_running' the row was created 'running' (single-agent flow) — proceed
 *   'skip'            the run was cancelled/failed while queued — do not execute it
 */
export async function markRunStarted(
  db: Db,
  runId: string,
): Promise<'started' | 'already_running' | 'skip'> {
  const started = await db
    .update(t.agentRuns)
    .set({ status: 'running', ranAt: new Date() })
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.status, 'queued')))
    .returning({ id: t.agentRuns.id });
  if (started.length > 0) return 'started';
  const [row] = await db.select({ status: t.agentRuns.status }).from(t.agentRuns).where(eq(t.agentRuns.id, runId));
  return row?.status === 'running' ? 'already_running' : 'skip';
}

export async function completeAgentRun(
  db: Db,
  runId: string,
  values: {
    status: 'done' | 'failed' | 'cancelled';
    durationMs: number;
    tokensIn: number;
    tokensOut: number;
    findingsCount: number;
    grounding: string;
    /** Actual/estimated LLM cost; null when unknown (e.g. failed before an LLM call). */
    costUsd?: number | null;
    /** Review score (0-100); null on failed/cancelled runs. */
    score?: number | null;
    /** Findings that tripped the agent's gate; 0 on failed/cancelled runs. */
    blockers?: number | null;
    /** Failure reason (status='failed') / cancellation note. Null clears it. */
    error?: string | null;
  },
): Promise<void> {
  await db
    .update(t.agentRuns)
    .set({
      status: values.status,
      durationMs: values.durationMs,
      tokensIn: values.tokensIn,
      tokensOut: values.tokensOut,
      findingsCount: values.findingsCount,
      grounding: values.grounding,
      costUsd: values.costUsd ?? null,
      score: values.score ?? null,
      blockers: values.blockers ?? null,
      error: values.error ?? null,
    })
    .where(eq(t.agentRuns.id, runId));
}

/** Persist the WHOLE run log as ONE document. PK = runId → agent_runs. */
export async function saveRunTrace(db: Db, runId: string, trace: RunTrace): Promise<void> {
  await db
    .insert(t.runTraces)
    .values({ runId, trace })
    .onConflictDoUpdate({ target: t.runTraces.runId, set: { trace } });
}

export async function getRunTrace(
  db: Db,
  workspaceId: string,
  runId: string,
): Promise<RunTrace | undefined> {
  const [row] = await db
    .select({ trace: t.runTraces.trace })
    .from(t.runTraces)
    .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.runTraces.runId))
    .where(and(eq(t.runTraces.runId, runId), eq(t.agentRuns.workspaceId, workspaceId)));
  return row ? (row.trace as RunTrace) : undefined;
}

// ---- multi-agent review read-model ----------------------------------------

/** The parent row of a multi-agent review, joined to its PR (for number). */
export type MultiAgentParentRow = {
  id: string;
  prId: string;
  prNumber: number | null;
  ranAt: Date;
};

/** One agent run under a parent, with the agent's name + its newest review +
 *  that review's findings. `agentName`/`review` may be null (agent deleted /
 *  run not yet done). */
export type MultiAgentRunRow = {
  run: AgentRunRow;
  agentName: string | null;
  review: { id: string; verdict: string | null; summary: string | null; score: number | null } | null;
  findings: FindingRow[];
};

/** Load the parent row IF it belongs to the workspace (else undefined → 403/404). */
export async function getMultiAgentParent(
  db: Db,
  workspaceId: string,
  parentId: string,
): Promise<MultiAgentParentRow | undefined> {
  const [row] = await db
    .select({
      id: t.multiAgentRuns.id,
      prId: t.multiAgentRuns.prId,
      prNumber: t.pullRequests.number,
      ranAt: t.multiAgentRuns.ranAt,
    })
    .from(t.multiAgentRuns)
    .leftJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
    .where(and(eq(t.multiAgentRuns.id, parentId), eq(t.multiAgentRuns.workspaceId, workspaceId)));
  return row ? { id: row.id, prId: row.prId, prNumber: row.prNumber ?? null, ranAt: row.ranAt } : undefined;
}

/**
 * All agent runs of one parent (by parent id, NOT a ran_at window), each with
 * its agent name, its newest review and that review's findings. Workspace-scoped
 * via the already-verified parent (callers must check the parent first).
 */
export async function runsForMultiAgentParent(
  db: Db,
  workspaceId: string,
  parentId: string,
): Promise<MultiAgentRunRow[]> {
  const runs = await db
    .select({ run: t.agentRuns, agentName: t.agents.name })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.multiAgentRunId, parentId)))
    .orderBy(desc(t.agentRuns.ranAt));
  if (runs.length === 0) return [];

  const runIds = runs.map((r) => r.run.id);
  const reviewRows = await db
    .select()
    .from(t.reviews)
    .where(and(eq(t.reviews.workspaceId, workspaceId), inArray(t.reviews.runId, runIds)))
    .orderBy(desc(t.reviews.createdAt));
  // newest review per run
  const reviewByRun = new Map<string, (typeof reviewRows)[number]>();
  for (const rv of reviewRows) {
    if (rv.runId && !reviewByRun.has(rv.runId)) reviewByRun.set(rv.runId, rv);
  }
  const reviewIds = [...reviewByRun.values()].map((r) => r.id);
  const findingRows =
    reviewIds.length > 0
      ? await db.select().from(t.findings).where(inArray(t.findings.reviewId, reviewIds))
      : [];

  return runs.map(({ run, agentName }) => {
    const review = run.id ? reviewByRun.get(run.id) : undefined;
    return {
      run,
      agentName: agentName ?? null,
      review: review
        ? { id: review.id, verdict: review.verdict, summary: review.summary, score: review.score }
        : null,
      findings: review ? findingRows.filter((f) => f.reviewId === review.id) : [],
    };
  });
}

// ---- estimate aggregation --------------------------------------------------

/**
 * Mean duration + cost of each agent's last N done, source='local' runs
 * workspace-wide (NOT PR-scoped; D8). Returns one entry per requested agent id,
 * with the sample size actually used (0 → caller marks it unavailable).
 *
 * `agent_runs.ran_at` is a timestamptz column; filter/sort with Drizzle's typed
 * operators (never a bare Date in a sql template — see server INSIGHTS).
 */
export async function estimateForAgents(
  db: Db,
  workspaceId: string,
  agentIds: string[],
  sampleLimit: number,
): Promise<{ agentId: string; meanDurationMs: number | null; meanCostUsd: number | null; sampleSize: number }[]> {
  if (agentIds.length === 0) return [];
  // One query for all requested agents; bucket per agent in memory and keep the
  // newest `sampleLimit` per agent.
  const rows = await db
    .select({
      agentId: t.agentRuns.agentId,
      durationMs: t.agentRuns.durationMs,
      costUsd: t.agentRuns.costUsd,
      ranAt: t.agentRuns.ranAt,
    })
    .from(t.agentRuns)
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        inArray(t.agentRuns.agentId, agentIds),
        eq(t.agentRuns.status, 'done'),
        eq(t.agentRuns.source, 'local'),
      ),
    )
    .orderBy(desc(t.agentRuns.ranAt));

  const byAgent = new Map<string, { durationMs: number | null; costUsd: number | null }[]>();
  for (const r of rows) {
    if (!r.agentId) continue;
    const bucket = byAgent.get(r.agentId) ?? [];
    if (bucket.length < sampleLimit) bucket.push({ durationMs: r.durationMs, costUsd: r.costUsd });
    byAgent.set(r.agentId, bucket);
  }

  return agentIds.map((agentId) => {
    const sample = byAgent.get(agentId) ?? [];
    const durations = sample.map((s) => s.durationMs).filter((d): d is number => d !== null);
    const costs = sample.map((s) => s.costUsd).filter((c): c is number => c !== null);
    return {
      agentId,
      meanDurationMs: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
      meanCostUsd: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
      sampleSize: sample.length,
    };
  });
}

// ---- multi-agent: latest run + single-agent baseline -----------------------

/**
 * Newest multi-agent review of the workspace (optionally limited to one repo),
 * used by the sidebar entry to decide between "show findings" and "configure".
 */
export async function latestMultiAgentRun(
  db: Db,
  workspaceId: string,
  repoId?: string,
): Promise<{ prId: string; parentId: string } | undefined> {
  const [row] = await db
    .select({ parentId: t.multiAgentRuns.id, prId: t.multiAgentRuns.prId })
    .from(t.multiAgentRuns)
    .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
    .where(
      and(
        eq(t.multiAgentRuns.workspaceId, workspaceId),
        ...(repoId ? [eq(t.pullRequests.repoId, repoId)] : []),
      ),
    )
    .orderBy(desc(t.multiAgentRuns.ranAt))
    .limit(1);
  return row ? { prId: row.prId, parentId: row.parentId } : undefined;
}

export type SingleAgentBaselineRow = {
  run: AgentRunRow;
  agentName: string | null;
};

/**
 * The most recent completed SINGLE-agent run (no parent, source='local') on this
 * PR by any of the given agents — the "1" in the "1 vs N" block (AC-51, D9).
 */
export async function singleAgentBaseline(
  db: Db,
  workspaceId: string,
  prId: string,
  agentIds: string[],
): Promise<SingleAgentBaselineRow | undefined> {
  if (agentIds.length === 0) return undefined;
  const [row] = await db
    .select({ run: t.agentRuns, agentName: t.agents.name })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.prId, prId),
        eq(t.agentRuns.source, 'local'),
        eq(t.agentRuns.status, 'done'),
        isNull(t.agentRuns.multiAgentRunId),
        inArray(t.agentRuns.agentId, agentIds),
      ),
    )
    .orderBy(desc(t.agentRuns.ranAt))
    .limit(1);
  return row ? { run: row.run, agentName: row.agentName ?? null } : undefined;
}
