"use client";

import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SectionLabel } from "@devdigest/ui";
import { useBlastRadius } from "@/features/reviews/api/hooks";
import { useResyncWithCompletion } from "@/lib/hooks/repo-intel";
import { blastKeys } from "@/shared/api/query-keys";
import { BlastRadiusBoundary, BlastRadiusCard } from "../BlastRadiusCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  repoId: string;
  repoFullName: string | null;
  headSha: string;
  /** The Intent card; shown beside Blast radius (stacked on narrow screens). */
  intent: React.ReactNode;
}

/** Overview tab container: fetches the blast radius and the index state so they load only while this tab is open. */
export function OverviewTab({ prBody, prId, repoId, repoFullName, headSha, intent }: OverviewTabProps) {
  const qc = useQueryClient();
  const blast = useBlastRadius(prId);
  // Reload the map when a resync finishes or gives up waiting, so the card never stays stale.
  const resync = useResyncWithCompletion(repoId, {
    onSettled: () => qc.invalidateQueries({ queryKey: blastKeys.byPull(prId) }),
  });

  return (
    <>
      <div style={s.grid}>
        {intent}
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
      {prBody && (
        <section style={s.descriptionSection}>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
