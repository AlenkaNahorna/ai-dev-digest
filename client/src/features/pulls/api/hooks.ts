"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PrMeta, PrDetail, SpecFile, IndexStatus } from "@/lib/types";
import { pullKeys } from "@/shared/api/query-keys";
export function usePulls(repoId: string | null | undefined) { return useQuery({ queryKey: pullKeys.list(repoId), queryFn: () => api.get<PrMeta[]>(`/repos/${repoId}/pulls`), enabled: !!repoId, refetchInterval: 60_000, refetchOnWindowFocus: true }); }
export function usePullDetail(prId: string | number | null | undefined) { return useQuery({ queryKey: pullKeys.detail(prId), queryFn: () => api.get<PrDetail>(`/pulls/${prId}`), enabled: prId != null }); }
export function useContextFiles(repoId: string | null | undefined) { return useQuery({ queryKey: ["context", repoId], queryFn: () => api.get<SpecFile[]>(`/repos/${repoId}/context`), enabled: !!repoId }); }
export function useReindexContext() { const qc = useQueryClient(); return useMutation({ mutationFn: (repoId: string) => api.post<IndexStatus>(`/repos/${repoId}/context/reindex`), onSuccess: (_d, repoId) => qc.invalidateQueries({ queryKey: ["context", repoId] }) }); }
export { pullKeys } from "@/shared/api/query-keys";
