"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Skill } from "./skills";

export type ConventionCategory =
  | "naming"
  | "structure"
  | "testing"
  | "error-handling"
  | "api-contract"
  | "other";

export type ConventionCandidate = {
  id: string;
  repo_id: string;
  run_id: string;
  category: ConventionCategory;
  rule: string;
  evidence_path: string;
  evidence_line_start: number;
  evidence_line_end: number;
  evidence_snippet: string;
  confidence: number;
  accepted: boolean;
  created_at: string;
};

export type ConventionExtractResult = {
  run_id: string;
  candidates: ConventionCandidate[];
  sample_files_count: number;
  scanned_at: string;
};

export type ConventionSkillDraft = {
  name: string;
  description: string;
  type: Skill["type"];
  body: string;
  evidence_files: string[];
};

/** GET /repos/:id/conventions — the latest scan (empty candidates before the first one). */
export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionExtractResult>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/** POST /repos/:id/conventions/extract — run the pipeline, replacing the cached scan on success. */
export function useExtractConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ConventionExtractResult>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (data) => qc.setQueryData(["conventions", repoId], data),
  });
}

/** PATCH /conventions/:id — Accept/Reject toggle; patches the cached scan in place. */
export function useSetConventionAccepted(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accepted }: { id: string; accepted: boolean }) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, { accepted }),
    onSuccess: (row) => {
      qc.setQueryData<ConventionExtractResult | undefined>(["conventions", repoId], (prev) =>
        prev ? { ...prev, candidates: prev.candidates.map((c) => (c.id === row.id ? row : c)) } : prev,
      );
    },
  });
}

/** POST /repos/:id/conventions/build-skill — merge accepted candidates into an editable skill draft. */
export function useBuildConventionSkill(repoId: string | null | undefined) {
  return useMutation({
    mutationFn: (candidateIds: string[]) =>
      api.post<ConventionSkillDraft>(`/repos/${repoId}/conventions/build-skill`, {
        candidate_ids: candidateIds,
      }),
  });
}
