"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CiExportInputBody } from "@devdigest/shared";
import { api } from "@/lib/api";
import { ciExportKeys, ciRunKeys } from "@/shared/api/query-keys";
import { parseCiExport, parseCiHistory, parseCiInstallations } from "../model/parse";
import type { CiExportResult, CiHistoryRow, CiInstallationRow } from "../model/types";

/** An agent's CI installations with each repo's latest run outcome (AC-1). */
export function useCiInstallations(agentId: string | null | undefined) {
  return useQuery<CiInstallationRow[]>({
    queryKey: ciExportKeys.installations(agentId),
    queryFn: async () => parseCiInstallations(await api.get(`/agents/${agentId}/ci-installations`)),
    enabled: !!agentId,
  });
}

/** Recent CI runs of this agent across its repos (CI tab history). */
export function useCiHistory(agentId: string | null | undefined) {
  return useQuery<CiHistoryRow[]>({
    queryKey: ciExportKeys.history(agentId),
    queryFn: async () => parseCiHistory(await api.get(`/agents/${agentId}/ci-runs`)),
    enabled: !!agentId,
  });
}

/**
 * Preview the generated files WITHOUT writing anything (wizard Preview step).
 * Uses `action: "files"`: no GitHub write, no installation, no token. The wizard
 * re-runs it whenever the Configure choices change so the shown workflow always
 * matches what Install will commit. No cache invalidation — nothing user-visible
 * changed yet.
 */
export function usePreviewCi(agentId: string | null | undefined) {
  return useMutation<CiExportResult, Error, CiExportInputBody>({
    mutationFn: async (input) =>
      parseCiExport(await api.post(`/agents/${agentId}/export-ci`, { ...input, action: "files" })),
  });
}

/**
 * Install step. Default `action: "open_pr"` opens or reuses the `devdigest/ci` PR
 * on the target repo (AC-5); the caller can pass `action: "zip"` to persist the
 * installation without touching GitHub (the wizard then packs the returned files
 * into a zip). Returns the generated files plus the one-time ingest token
 * (AC-7/AC-8). Invalidates the installations list, history and CI Runs on success.
 */
export function useExportCi(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation<CiExportResult, Error, CiExportInputBody>({
    mutationFn: async (input) =>
      parseCiExport(await api.post(`/agents/${agentId}/export-ci`, { action: "open_pr", ...input })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ciExportKeys.installations(agentId) });
      void qc.invalidateQueries({ queryKey: ciExportKeys.history(agentId) });
      void qc.invalidateQueries({ queryKey: ciRunKeys.all });
    },
  });
}
