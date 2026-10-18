"use client";

import React from "react";
import { AppShell } from "@/components/app-shell";
import { useCiRuns } from "../api/hooks";
import { CiRunsView } from "./CiRunsView";

/** Route: /ci-runs — the 50 most recent workspace CI runs (read-only). */
export function CiRunsScreen() {
  const { data, isLoading, isError, refetch } = useCiRuns();
  const crumb = [{ label: "CI Runs" }];

  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>CI Runs</h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            The 50 most recent reviews from agents running in GitHub Actions.
          </div>
        </div>
        <CiRunsView
          runs={data}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => void refetch()}
        />
      </div>
    </AppShell>
  );
}
