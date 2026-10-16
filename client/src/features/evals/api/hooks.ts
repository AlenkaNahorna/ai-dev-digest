"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { evalKeys } from "@/shared/api/query-keys";
import type {
  EvalBatchDetail,
  EvalBatchList,
  EvalCaseDraft,
  EvalCaseList,
  EvalCaseOverrides,
  EvalCaseRecord,
  EvalCompare,
  EvalImportResult,
  EvalOverview,
  EvalTryInput,
  EvalTryResult,
} from "@devdigest/shared";

/** The agent's eval cases with the latest pass/fail of each. */
export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.cases(agentId),
    queryFn: () => api.get<EvalCaseList>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

/** Run history of an agent (batches), newest first. */
export function useEvalBatches(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.batches(agentId),
    queryFn: () => api.get<EvalBatchList>(`/agents/${agentId}/eval-runs`),
    enabled: !!agentId,
  });
}

export function useEvalBatch(batchId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.batch(batchId),
    queryFn: () => api.get<EvalBatchDetail>(`/eval-runs/${batchId}`),
    enabled: !!batchId,
  });
}

/** Two batches side by side: metric deltas, per-case changes, both prompts. */
export function useEvalCompare(a: string | null | undefined, b: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.compare(a, b),
    queryFn: () => api.get<EvalCompare>(`/eval-runs/compare?a=${a}&b=${b}`),
    enabled: !!a && !!b,
  });
}

/** Eval Dashboard data: every agent's latest run + trend, and the most recent runs. */
export function useEvalOverview() {
  return useQuery({ queryKey: evalKeys.overview, queryFn: () => api.get<EvalOverview>("/eval/overview") });
}

/** "Run all evals": one model call per case; `isPending` disables the button. */
export function useRunEvals(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalBatchDetail>(`/agents/${agentId}/eval-runs`),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.all }),
  });
}

/** Opens the "New eval case" modal: the seeded case for a decided finding (nothing is stored). */
export function useEvalCaseDraft() {
  return useMutation({
    mutationFn: (findingId: string) => api.get<EvalCaseDraft>(`/findings/${findingId}/eval-case-draft`),
  });
}

/** "Save" in the modal; without `overrides` it stores the seeded case as is. */
export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId, overrides }: { findingId: string; overrides?: EvalCaseOverrides }) =>
      api.post<EvalCaseRecord>(`/findings/${findingId}/eval-case`, overrides),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.all }),
  });
}

/** "Run case" in the modal: one run on the draft, scored in code, not stored. */
export function useTryEvalCase(agentId: string | null | undefined) {
  return useMutation({
    mutationFn: (input: EvalTryInput) => api.post<EvalTryResult>(`/agents/${agentId}/eval-cases/try`, input),
  });
}

export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.del<void>(`/eval-cases/${caseId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.all }),
  });
}

export function useImportEvalCases(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalImportResult>(`/agents/${agentId}/eval-cases/import`),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.all }),
  });
}

/** "Run" on one case row: runs the agent on that case; its result becomes the row's latest result. */
export function useRunEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.post<EvalTryResult>(`/eval-cases/${caseId}/run`),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.all }),
  });
}

/** "Edit" on a case row (name, diff fragment, expectation). */
export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, overrides }: { caseId: string; overrides: EvalCaseOverrides }) =>
      api.patch<EvalCaseRecord>(`/eval-cases/${caseId}`, overrides),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.all }),
  });
}
