"use client";
import React from "react";
import { EmptyState, Skeleton } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { usePublicTour } from "../api/hooks";
import { SECTION_ORDER, provenanceLine } from "../model/view";
import { OnThisPage, TourSections } from "./TourSections";

/**
 * Route: /share/onboarding/:token — anonymous, read-only snapshot. Renders only
 * what the public endpoint returns; no shell, no repo list, no private API calls.
 */
export function PublicTourScreen({ token }: { token: string }) {
  const { data, isLoading, isError, error } = usePublicTour(token);

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "28px 20px" }}>
        {isLoading ? (
          <div aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Skeleton height={40} />
            <Skeleton height={220} />
          </div>
        ) : isError || !data ? (
          <EmptyState
            icon="Link"
            title="This link is not available"
            body={
              error instanceof ApiError && error.status === 0
                ? "The service could not be reached. Try again in a moment."
                : "It may have been revoked or mistyped. Ask the person who shared it for a new link."
            }
          />
        ) : (
          <>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>DevDigest · shared, read-only snapshot</div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
              Onboarding for{" "}
              <span className="mono" style={{ color: "var(--accent-text)" }}>
                {data.repository.full_name}
              </span>
            </h1>
            <p style={{ color: "var(--text-secondary)", marginTop: 4, fontSize: 13.5, marginBottom: 20 }}>
              Generated from {provenanceLine(data.provenance)} · shared {new Date(data.shared_at).toLocaleDateString()}
            </p>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_200px]">
              <TourSections content={data.content} provenance={data.provenance} repoFullName={data.repository.full_name} />
              <div className="hidden lg:block">
                <OnThisPage keys={SECTION_ORDER} />
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
