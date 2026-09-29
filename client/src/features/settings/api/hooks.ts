"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Settings, SettingsUpdate, ConnTestProvider, ConnTestResult, SecretsStatus } from "@/lib/types";
import { settingsKeys } from "@/shared/api/query-keys";
export function useSettings() { return useQuery({ queryKey: settingsKeys.all, queryFn: () => api.get<Settings>("/settings") }); }
export function useUpdateSettings() { const qc = useQueryClient(); return useMutation({ mutationFn: (patch: SettingsUpdate) => api.put<Settings>("/settings", patch), onSuccess: (data) => qc.setQueryData(settingsKeys.all, data) }); }
export function useTestConnection() { const qc = useQueryClient(); return useMutation({ mutationFn: (input: ConnTestProvider | { provider: ConnTestProvider; key?: string }) => api.post<ConnTestResult>("/settings/test-connection", typeof input === "string" ? { provider: input } : input), onSuccess: (res) => { if (res.ok) { qc.invalidateQueries({ queryKey: ["provider-models"] }); qc.invalidateQueries({ queryKey: settingsKeys.secrets }); } } }); }
export function useSecretsStatus() { return useQuery({ queryKey: settingsKeys.secrets, queryFn: () => api.get<SecretsStatus>("/settings/secrets-status"), staleTime: 30_000 }); }
