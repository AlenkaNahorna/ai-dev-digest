"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CiExportInputBody } from "@devdigest/shared";
import { api } from "@/lib/api";
import { ciExportKeys, ciRunKeys } from "@/shared/api/query-keys";
import { parseCiExport, parseCiInstallations } from "../model/parse";
import type { CiExportResult, CiInstallationRow } from "../model/types";

/** An agent's CI installations with each repo's latest run outcome (AC-1). */
export function useCiInstallations(agentId: string | null | undefined) {
  return useQuery<CiInstallationRow[]>({
    queryKey: ciExportKeys.installations(agentId),
    queryFn: async () => parseCiInstallations(await api.get(`/agents/${agentId}/ci-installations`)),
    enabled: !!agentId,
  });
}

/**
 * Preview the generated files WITHOUT opening a PR (AC-2 "see a preview of the
 * files with contents, then confirm"). Uses `action: "files"`, which the server
 * documents as "just returns/persists them". No cache invalidation — nothing
 * user-visible changed yet.
 */
export function usePreviewCi(agentId: string | null | undefined) {
  return useMutation<CiExportResult, Error, CiExportInputBody>({
    mutationFn: async (input) =>
      parseCiExport(await api.post(`/agents/${agentId}/export-ci`, { ...input, action: "files" })),
  });
}

/**
 * "Add to CI" / re-export: opens or reuses a PR on the target repo (AC-5) and
 * returns the generated files plus the one-time ingest token (AC-7/AC-8).
 * Invalidates the installations list and the CI Runs list on success.
 */
export function useExportCi(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation<CiExportResult, Error, CiExportInputBody>({
    mutationFn: async (input) =>
      parseCiExport(await api.post(`/agents/${agentId}/export-ci`, { ...input, action: "open_pr" })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ciExportKeys.installations(agentId) });
      void qc.invalidateQueries({ queryKey: ciRunKeys.all });
    },
  });
}
