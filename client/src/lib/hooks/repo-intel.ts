/* hooks/repo-intel.ts — React Query hooks for the repo-intel (T3) index state.
   Mirrors hooks/context.ts (useIndexStatus/useReindex) but targets the
   repo-intel facade's HTTP surface:
     GET  /repos/:id/index-state  → RepoIntelState
     POST /repos/:id/resync       → fetch latest from origin + incremental
                                     reindex (202). NOT a destructive re-clone. */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

/** Subset of the server's IndexState the badge + completion-poll need (kept
    local — not in @devdigest/shared, since repo-intel types live server-side). */
export interface RepoIntelState {
  status: "full" | "partial" | "degraded" | "failed";
  filesIndexed: number;
  filesSkipped: number;
  /** Advances when a resync writes a new index row → the UI's completion signal. */
  lastIndexedSha: string;
  updatedAt: string;
  degraded?: boolean;
  degradedReason?: string;
  reason?: string;
}

/** GET /repos/:id/index-state → current repo-intel index state.
    While `poll` is true, refetch on an interval so a running resync's result
    becomes visible. The caller (ProjectContextView) owns when to stop polling
    (the status enum is terminal-only, so completion is detected by watching
    `lastIndexedSha`/`updatedAt` advance, not by status). */
export function useRepoIntelStatus(repoId: string | null | undefined, poll = false) {
  return useQuery({
    queryKey: ["repo-intel-state", repoId],
    queryFn: () => api.get<RepoIntelState>(`/repos/${repoId}/index-state`),
    enabled: !!repoId,
    refetchInterval: poll ? 1500 : false,
  });
}

/** The API answers 202 even when no job could be enqueued; that case carries `degraded: true`. */
export interface ResyncResponse {
  status: string;
  jobId?: string;
  degraded?: boolean;
  reason?: string;
}

/** POST /repos/:id/resync → fetch latest + incremental reindex (resync, not re-clone). */
export function useResyncRepoIntel(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ResyncResponse>(`/repos/${repoId}/resync`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["repo-intel-state", repoId] });
    },
  });
}

/** Stop waiting for a resync to finish after this long. */
export const RESYNC_WAIT_MS = 90_000;

export interface ResyncWithCompletionOptions {
  /** Called once per resync: "done" when the index advanced, "timeout" when it did not in time. */
  onSettled?: (outcome: "done" | "timeout") => void;
  waitMs?: number;
}

/**
 * Resync a repo and report when the index has actually advanced. The job is asynchronous (the
 * POST returns 202 at once), so after a successful enqueue this polls the index state until
 * `updatedAt` changes. If the baseline is not known yet it is taken from the first poll, so a
 * late-loading state can never be mistaken for completion. A degraded 202 (no job enqueued)
 * is reported as an error, and a resync that does not finish in time as `timedOut`.
 */
export function useResyncWithCompletion(
  repoId: string | null | undefined,
  { onSettled, waitMs = RESYNC_WAIT_MS }: ResyncWithCompletionOptions = {},
) {
  // `baseline` = index updatedAt when the resync started; null = not seen yet.
  const [wait, setWait] = useState<{ baseline: string | null } | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const waiting = wait !== null;
  const state = useRepoIntelStatus(repoId, waiting);
  const resync = useResyncRepoIntel(repoId);
  const updatedAt = state.data?.updatedAt;
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  });

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => {
      setWait(null);
      setTimedOut(true);
      settledRef.current?.("timeout");
    }, waitMs);
    return () => window.clearTimeout(timer);
  }, [waiting, waitMs]);

  useEffect(() => {
    if (!wait || updatedAt === undefined) return;
    if (wait.baseline === null) {
      setWait({ baseline: updatedAt });
    } else if (updatedAt !== wait.baseline) {
      setWait(null);
      settledRef.current?.("done");
    }
  }, [wait, updatedAt]);

  const { mutate } = resync;
  const start = useCallback(() => {
    setTimedOut(false);
    mutate(undefined, { onSuccess: (res) => { if (!res.degraded) setWait({ baseline: updatedAt ?? null }); } });
  }, [mutate, updatedAt]);

  return {
    status: state.data,
    start,
    resyncing: resync.isPending || waiting,
    error: resync.isError || resync.data?.degraded === true,
    timedOut,
  };
}
