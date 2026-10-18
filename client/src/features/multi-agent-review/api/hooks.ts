/* Multi-agent review data hooks (TanStack Query over the Fastify API).
   - useStartMultiAgentRun: POST /pulls/:id/multi-agent-run { agent_ids } → parent id + per-agent runs.
   - useMultiAgentResults:   GET /pulls/:id/multi-agent/:parentId → MultiAgentRun; polls every 2s while a column is still queued/running (AC-36).
   - useMultiAgentEstimate:  POST /pulls/:id/multi-agent/estimate { agent_ids } → per-agent prior means.
   On a run reaching a terminal status, review/run/pulls caches are invalidated so the PR list/detail drop stale score/findings (client INSIGHTS 2026-09-21). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MultiAgentEstimate, MultiAgentRun } from "@devdigest/shared";
import { multiAgentKeys, pullKeys, reviewKeys, runKeys } from "@/shared/api/query-keys";

const POLL_MS = 2000;

export interface StartMultiAgentRunResponse {
  parent_id: string;
  runs: { run_id: string; agent_id: string; agent_name: string }[];
}

/** Start one parent-grouped run over the selected agent ids (1..6). */
export function useStartMultiAgentRun(prId: string | null | undefined) {
  return useMutation({
    mutationFn: (agentIds: string[]) =>
      api.post<StartMultiAgentRunResponse>(`/pulls/${prId}/multi-agent-run`, { agent_ids: agentIds }),
  });
}

/** A column is "active" while its run is still queued or running. */
function anyColumnActive(run: MultiAgentRun | undefined): boolean {
  return (run?.columns ?? []).some((c) => c.status === "queued" || c.status === "running");
}

/**
 * Poll the parent run's results every 2s while any column is still active; stop
 * once all columns are terminal. On that transition, invalidate the PR's
 * review/run/pulls caches so other surfaces drop stale data.
 */
export function useMultiAgentResults(
  prId: string | null | undefined,
  parentId: string | null | undefined,
  repoId?: string | null,
) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: multiAgentKeys.results(prId, parentId),
    queryFn: async () => {
      const run = await api.get<MultiAgentRun>(`/pulls/${prId}/multi-agent/${parentId}`);
      if (!anyColumnActive(run)) {
        if (prId) {
          qc.invalidateQueries({ queryKey: reviewKeys.byPull(prId) });
          qc.invalidateQueries({ queryKey: runKeys.history(prId) });
          qc.invalidateQueries({ queryKey: runKeys.active(prId) });
        }
        if (repoId) qc.invalidateQueries({ queryKey: pullKeys.list(repoId) });
      }
      return run;
    },
    enabled: !!prId && !!parentId,
    refetchInterval: (q) => (anyColumnActive(q.state.data) ? POLL_MS : false),
  });
}

/** Pre-run estimate for the current selection (empty selection → not fetched). */
export function useMultiAgentEstimate(prId: string | null | undefined, agentIds: string[]) {
  return useQuery({
    queryKey: multiAgentKeys.estimate(prId, agentIds),
    queryFn: () =>
      api.post<MultiAgentEstimate>(`/pulls/${prId}/multi-agent/estimate`, { agent_ids: agentIds }),
    enabled: !!prId && agentIds.length > 0,
  });
}
