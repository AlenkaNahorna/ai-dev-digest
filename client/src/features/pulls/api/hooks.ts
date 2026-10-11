"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PrMeta, PrDetail } from "@/lib/types";
import { pullKeys } from "@/shared/api/query-keys";
export function usePulls(repoId: string | null | undefined) { return useQuery({ queryKey: pullKeys.list(repoId), queryFn: () => api.get<PrMeta[]>(`/repos/${repoId}/pulls`), enabled: !!repoId, refetchInterval: 60_000, refetchOnWindowFocus: true }); }
export function usePullDetail(prId: string | number | null | undefined) { return useQuery({ queryKey: pullKeys.detail(prId), queryFn: () => api.get<PrDetail>(`/pulls/${prId}`), enabled: prId != null }); }
export { pullKeys } from "@/shared/api/query-keys";
