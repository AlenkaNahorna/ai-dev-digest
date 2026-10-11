"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ContextAttachments,
  ContextAttachmentsInput,
  ContextDocBody,
  ProjectContextList,
} from "@devdigest/shared";
import { api } from "@/lib/api";
import { contextKeys, type ContextOwnerKind } from "@/shared/api/query-keys";

const ownerPath = (kind: ContextOwnerKind) => (kind === "agent" ? "agents" : "skills");

/** Discovered `.md` documents of a repo with tokens + footer facts (view-only). */
export function useProjectContext(repoId: string | null | undefined) {
  return useQuery({
    queryKey: contextKeys.list(repoId),
    queryFn: () => api.get<ProjectContextList>(`/repos/${repoId}/context`),
    enabled: !!repoId,
  });
}

/** One document's full text for Preview. */
export function useContextDoc(repoId: string | null | undefined, path: string | null | undefined) {
  return useQuery({
    queryKey: contextKeys.doc(repoId, path),
    queryFn: () => api.get<ContextDocBody>(`/repos/${repoId}/context/doc?path=${encodeURIComponent(path ?? "")}`),
    enabled: !!repoId && !!path,
  });
}

/** Stored attachments of an agent or skill for one repo (ordered; `missing` flagged). */
export function useContextAttachments(
  kind: ContextOwnerKind,
  ownerId: string | null | undefined,
  repoId: string | null | undefined,
) {
  return useQuery({
    queryKey: contextKeys.attachments(kind, ownerId, repoId),
    queryFn: () => api.get<ContextAttachments>(`/${ownerPath(kind)}/${ownerId}/context?repo_id=${repoId}`),
    enabled: !!ownerId && !!repoId,
  });
}

/** Replace the whole attachment set atomically (paths + order only). Does not version the agent/skill. */
export function useSaveContextAttachments(kind: ContextOwnerKind, ownerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ContextAttachmentsInput) =>
      api.put<ContextAttachments>(`/${ownerPath(kind)}/${ownerId}/context`, input),
    onSuccess: (data, vars) => {
      qc.setQueryData(contextKeys.attachments(kind, ownerId, vars.repo_id), data);
      // "Used by N agents" on the list changes with every attachment change.
      void qc.invalidateQueries({ queryKey: contextKeys.list(vars.repo_id) });
    },
  });
}

/**
 * Refresh = existing repo resync (fetch latest from origin) followed by a list
 * refetch, which re-scans the roots and recounts tokens. The refetch also runs
 * when the resync fails, so the page still shows the clone as last synced.
 */
export function useRefreshProjectContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.post<{ status: string }>(`/repos/${repoId}/resync`),
    onSettled: (_d, _e, repoId) => qc.invalidateQueries({ queryKey: contextKeys.list(repoId) }),
  });
}
