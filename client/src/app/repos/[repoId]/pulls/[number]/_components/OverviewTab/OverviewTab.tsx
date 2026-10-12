"use client";

import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SectionLabel } from "@devdigest/ui";
import { useBlastRadius, useGenerateBrief, usePrBrief } from "@/features/reviews/api/hooks";
import { useResyncWithCompletion } from "@/lib/hooks/repo-intel";
import { ApiError } from "@/lib/api";
import { blastKeys } from "@/shared/api/query-keys";
import { BlastRadiusBoundary, BlastRadiusCard } from "../BlastRadiusCard";
import { BriefBanner } from "../BriefCard/BriefBanner";
import { BriefBoundary } from "../BriefCard/BriefBoundary";
import { ReviewFocus } from "../BriefCard/ReviewFocus";
import { RiskAreas } from "../BriefCard/RiskAreas";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  repoId: string;
  repoFullName: string | null;
  headSha: string;
  /** The Intent card; shown beside Blast radius (stacked on narrow screens). */
  intent: React.ReactNode;
  /** Open Files changed scrolled to this file (Review focus click). */
  onOpenFile: (file: string) => void;
}

/** Overview tab container: fetches the PR brief, the blast radius and the index state so they load only while this tab is open. */
export function OverviewTab({ prBody, prId, repoId, repoFullName, headSha, intent, onOpenFile }: OverviewTabProps) {
  const qc = useQueryClient();
  const blast = useBlastRadius(prId);
  const brief = usePrBrief(prId);
  const generate = useGenerateBrief(prId);
  const generateError = generate.isError
    ? { message: generate.error instanceof Error ? generate.error.message : "", code: generate.error instanceof ApiError ? generate.error.code : undefined }
    : null;
  const stored = brief.data ?? null;
  // Reload the map when a resync finishes or gives up waiting, so the card never stays stale.
  const resync = useResyncWithCompletion(repoId, {
    onSettled: () => qc.invalidateQueries({ queryKey: blastKeys.byPull(prId) }),
  });

  return (
    <>
      <BriefBoundary resetKey={brief.data} onRetry={() => brief.refetch()}>
        <BriefBanner
          brief={brief.isError ? undefined : brief.data}
          isLoading={brief.isLoading}
          isLoadError={brief.isError}
          onRetryLoad={() => brief.refetch()}
          onGenerate={() => generate.mutate()}
          generating={generate.isPending}
          generateError={generateError}
        />
      </BriefBoundary>
      <div style={s.grid}>
        <div style={s.column}>
          {intent}
          {stored && (
            <BriefBoundary resetKey={stored} onRetry={() => brief.refetch()}>
              <RiskAreas risks={stored.risks} />
            </BriefBoundary>
          )}
        </div>
        <BlastRadiusBoundary resetKey={blast.data} onRetry={() => blast.refetch()}>
          <BlastRadiusCard
            data={blast.data}
            isLoading={blast.isLoading}
            isError={blast.isError}
            onRetry={() => blast.refetch()}
            repoFullName={repoFullName}
            headSha={headSha}
            index={{
              status: resync.status?.status,
              reason: resync.status?.degradedReason ?? resync.status?.reason,
              onResync: resync.start,
              resyncing: resync.resyncing,
              resyncError: resync.error,
              timedOut: resync.timedOut,
            }}
          />
        </BlastRadiusBoundary>
      </div>
      {stored && (
        <BriefBoundary resetKey={stored} onRetry={() => brief.refetch()}>
          <ReviewFocus items={stored.review_focus} onSelect={onOpenFile} />
        </BriefBoundary>
      )}
      {prBody && (
        <section style={s.descriptionSection}>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
