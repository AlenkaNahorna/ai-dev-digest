"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { evalKeys } from "@/shared/api/query-keys";
import type {
  EvalTryInput,
  SkillEvalCaseInput,
  SkillEvalCaseList,
  SkillEvalCaseRecord,
  SkillPairResult,
  SkillRunSummary,
} from "@devdigest/shared";

/** The skill's hand-written cases with the latest with / without-skill result. */
export function useSkillEvalCases(skillId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.skillCases(skillId),
    queryFn: () => api.get<SkillEvalCaseList>(`/skills/${skillId}/eval-cases`),
    enabled: !!skillId,
  });
}

export function useCreateSkillEvalCase(skillId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SkillEvalCaseInput) => api.post<SkillEvalCaseRecord>(`/skills/${skillId}/eval-cases`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.all }),
  });
}

/** "Run case" in the modal: both sides on a draft, nothing stored. */
export function useTrySkillCase(skillId: string | null | undefined) {
  return useMutation({
    mutationFn: (input: EvalTryInput) => api.post<SkillPairResult>(`/skills/${skillId}/eval-cases/try`, input),
  });
}

export function useRunSkillEvalCase(skillId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.post<SkillPairResult>(`/skills/${skillId}/eval-cases/${caseId}/run`),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.all }),
  });
}

/** "Run all evals": every case with and without the skill. */
export function useRunSkillEvals(skillId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<SkillRunSummary>(`/skills/${skillId}/eval-runs`),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.all }),
  });
}
