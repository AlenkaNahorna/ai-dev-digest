"use client";
import React from "react";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useOnboardingTour, useRegenerateTour } from "../api/hooks";
import { OnboardingTourView } from "./OnboardingTourView";
import { ShareDialog } from "./ShareDialog";

/** Route: /repos/:repoId/onboarding — the persisted Onboarding Tour. */
export function OnboardingTourScreen({ repoId }: { repoId: string }) {
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data: state, isLoading, error, refetch } = useOnboardingTour(repoId);
  const regenerate = useRegenerateTour(repoId);
  const [sharing, setSharing] = React.useState(false);

  const repoName = activeRepo?.id === repoId ? activeRepo.full_name : null;
  const crumb = [{ label: repoName ?? "Repository", mono: true }, { label: "Onboarding Tour" }];

  return (
    <AppShell crumb={crumb}>
      {repoNotFound ? (
        <RepoNotFound />
      ) : (
        <OnboardingTourView
          repoName={repoName}
          state={state}
          isLoading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          onRegenerate={() => regenerate.mutate()}
          regenerating={regenerate.isPending}
          regenerateError={regenerate.error}
          onShare={() => setSharing(true)}
        />
      )}
      {sharing && state?.tour && (
        <ShareDialog
          repoId={repoId}
          tourId={state.tour.tour_id}
          sourceSha={state.tour.provenance.source_sha}
          publicOriginConfigured={state.public_origin_configured}
          onClose={() => setSharing(false)}
        />
      )}
    </AppShell>
  );
}

