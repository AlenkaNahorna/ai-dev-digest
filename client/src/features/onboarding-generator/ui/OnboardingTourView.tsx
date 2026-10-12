"use client";
import React from "react";
import type { OnboardingTourState } from "@devdigest/shared/contracts/onboarding-generator";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { SECTION_ORDER, bannersFor, provenanceLine, screenMode, type Banner } from "../model/view";
import { OnThisPage, TourSections } from "./TourSections";

const BANNER_STYLE: Record<Banner["kind"], { color: string; icon: "RefreshCw" | "AlertTriangle" | "Clock" | "Info" }> = {
  generating: { color: "var(--accent-text)", icon: "RefreshCw" },
  failed: { color: "var(--danger)", icon: "AlertTriangle" },
  budget: { color: "var(--warn)", icon: "Clock" },
  stale: { color: "var(--warn)", icon: "Info" },
};

function BannerRow({ banner }: { banner: Banner }) {
  const s = BANNER_STYLE[banner.kind];
  const I = Icon[s.icon];
  return (
    <div
      role={banner.kind === "failed" ? "alert" : "status"}
      style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 14px", border: `1px solid ${s.color}`, borderRadius: 8, fontSize: 13.5, color: "var(--text-primary)" }}
    >
      <I size={16} color={s.color} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{banner.text}</span>
    </div>
  );
}

export interface TourViewProps {
  repoName: string | null;
  state: OnboardingTourState | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
  regenerateError: unknown;
  onShare: () => void;
}

/** Presentational body of the tour page (everything inside the app shell). Hooks live in the screen. */
export function OnboardingTourView(p: TourViewProps) {
  const { state } = p;
  const shortName = p.repoName ? p.repoName.split("/").pop()! : "this repository";
  const mode = screenMode(state);
  const generating = state?.generation.status === "queued" || state?.generation.status === "running";
  const canRegenerate = state?.permissions.can_regenerate === true;
  const canShare = state?.permissions.can_share === true && !!state.tour;
  const denied = state?.permissions.denied_reason;
  const isError = p.error != null && !state;

  return (
    <div style={{ padding: 28, maxWidth: 1120 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 18 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
            Onboarding for{" "}
            <span className="mono" style={{ color: "var(--accent-text)" }}>
              {shortName}
            </span>
          </h1>
          <p style={{ color: "var(--text-secondary)", marginTop: 4, fontSize: 13.5 }} data-testid="tour-subtitle">
            {state?.tour
              ? `Generated from ${provenanceLine(state.tour.provenance)}`
              : "A guided tour generated from this repository's index."}
          </p>
        </div>
        {mode === "ready" && (
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <Button
              kind="secondary"
              icon="RefreshCw"
              onClick={p.onRegenerate}
              loading={p.regenerating || generating}
              disabled={!canRegenerate || generating}
              title={!canRegenerate ? ownerHint(denied) : undefined}
            >
              Regenerate
            </Button>
            <Button
              kind="primary"
              icon="Link"
              onClick={p.onShare}
              disabled={!canShare}
              title={!canShare ? ownerHint(denied) : undefined}
            >
              Share link
            </Button>
          </div>
        )}
      </div>

      {p.isLoading || (!state && !isError) ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }} aria-busy="true">
          <Skeleton height={56} />
          <Skeleton height={220} />
          <Skeleton height={120} />
        </div>
      ) : isError || !state ? (
        <ErrorState
          title="Could not load the onboarding tour"
          body={p.error instanceof ApiError ? p.error.message : "Try again."}
          onRetry={p.onRetry}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {bannersFor(state).map((b) => (
            <BannerRow key={b.kind} banner={b} />
          ))}
          {p.regenerateError != null && (
            <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>
              {p.regenerateError instanceof Error ? p.regenerateError.message : "Could not start generation."}
            </div>
          )}

          {mode === "index_required" && (
            <EmptyState
              icon="Database"
              title="Index this repository first"
              body="The onboarding tour is built from the repository index (ranked files, import graph and symbols). Once indexing completes, the tour is generated automatically."
            />
          )}

          {mode === "no_tour" && (
            <EmptyState
              icon="Workflow"
              title={generating ? "Generating your tour…" : "No tour yet"}
              body={
                generating
                  ? "This usually takes under a minute. This page updates when it is ready."
                  : canRegenerate
                    ? "The repository is indexed but no tour has been generated yet."
                    : ownerHint(denied)
              }
              cta={!generating && canRegenerate ? "Generate tour" : undefined}
              onCta={p.onRegenerate}
              ctaLoading={p.regenerating}
            />
          )}

          {mode === "ready" && state.tour && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_200px]">
              <TourSections content={state.tour.content} provenance={state.tour.provenance} repoFullName={p.repoName} />
              <div className="hidden lg:block">
                <OnThisPage keys={SECTION_ORDER} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ownerHint(denied: "not_owner" | "owner_unassigned" | null | undefined): string {
  if (denied === "owner_unassigned") return "This repository has no assigned owner, so generating and sharing are unavailable.";
  return "Only the repository owner can generate or share the tour.";
}
