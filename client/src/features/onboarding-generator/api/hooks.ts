"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  OnboardingTourState,
  PublicOnboardingSnapshot,
  RegenerateAccepted,
  ShareCreated,
  ShareList,
  ShareRevoked,
} from "@devdigest/shared/contracts/onboarding-generator";
import { api, ApiError } from "@/lib/api";
import { onboardingTourKeys } from "@/shared/api/query-keys";
import { parsePublicSnapshot, parseTourState } from "../model/parse";

/** Poll while a generation request is in flight; stop as soon as it settles. */
const POLL_MS = 2500;

/** Persisted tour state (never triggers generation). */
export function useOnboardingTour(repoId: string | null | undefined) {
  return useQuery({
    queryKey: onboardingTourKeys.state(repoId),
    queryFn: async (): Promise<OnboardingTourState> => parseTourState(await api.get<unknown>(`/repos/${repoId}/onboarding-tour`)),
    enabled: !!repoId,
    refetchInterval: (q) => {
      const status = q.state.data?.generation.status;
      return status === "queued" || status === "running" ? POLL_MS : false;
    },
  });
}

/** Owner-only Generate / Regenerate. The previous successful tour stays visible until a new one lands. */
export function useRegenerateTour(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<RegenerateAccepted>(`/repos/${repoId}/onboarding-tour/regenerate`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: onboardingTourKeys.state(repoId) }),
  });
}

/** Owner-only share metadata (opaque; the raw link is only ever returned at creation). */
export function useTourShares(repoId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: onboardingTourKeys.shares(repoId),
    queryFn: () => api.get<ShareList>(`/repos/${repoId}/onboarding-tour/shares`),
    enabled: !!repoId && enabled,
    // The list can contain revoked state changed elsewhere; never reuse a stale entry for long.
    staleTime: 0,
  });
}

/** Publish an immutable snapshot of the DISPLAYED version (by id). */
export function useCreateShare(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tourId: string) =>
      api.post<ShareCreated>(`/repos/${repoId}/onboarding-tour/shares`, { tour_id: tourId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: onboardingTourKeys.shares(repoId) }),
  });
}

export function useRevokeShare(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) =>
      api.del<ShareRevoked>(`/repos/${repoId}/onboarding-tour/shares/${shareId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: onboardingTourKeys.shares(repoId) }),
  });
}

/** Anonymous snapshot by token. Never retried: a 404 is final (invalid and revoked look the same). */
export function usePublicTour(token: string) {
  return useQuery({
    queryKey: onboardingTourKeys.publicSnapshot(token),
    queryFn: async (): Promise<PublicOnboardingSnapshot> =>
      parsePublicSnapshot(await api.get<unknown>(`/public/onboarding/${encodeURIComponent(token)}`)),
    retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 1,
    staleTime: Infinity,
    refetchOnMount: false,
  });
}
