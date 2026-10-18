"use client";

import React from "react";
import { Badge, Button, Card, EmptyState, ErrorState } from "@devdigest/ui";
import { relativeTime, toneColors, verdictDisplay } from "../lib/format";
import type { CiInstallationRow } from "../model/types";

/**
 * Presentational CI tab: props in, callbacks out. State matrices (loading /
 * error / empty / populated) are testable without mocking data hooks or
 * navigation (client/INSIGHTS.md 2026-10-11).
 */
export function CiTabView({
  installations,
  isLoading,
  isError,
  onRetry,
  onAddToCi,
}: {
  installations: CiInstallationRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onAddToCi: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: 14, margin: 0 }}>Continuous integration</h3>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
            Run this agent on every pull request in a GitHub repository.
          </div>
        </div>
        <Button kind="primary" icon="GitBranch" onClick={onAddToCi}>
          Add to CI
        </Button>
      </div>

      {isLoading ? (
        <div>Loading installations…</div>
      ) : isError ? (
        <ErrorState title="Couldn't load CI installations." onRetry={onRetry} />
      ) : !installations || installations.length === 0 ? (
        <EmptyState
          icon="Workflow"
          title="Not installed in any repository yet"
          body="Use Add to CI to export this agent into a repository and open a pull request."
        />
      ) : (
        <Card>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {installations.map((inst) => {
              const v = verdictDisplay(inst.latest_verdict);
              const colors = toneColors(v.tone);
              return (
                <li
                  key={inst.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 13, flex: 1 }}>{inst.repo}</span>
                  <Badge color={colors.color} bg={colors.bg}>
                    {v.label}
                  </Badge>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 72, textAlign: "right" }}>
                    {relativeTime(inst.latest_ran_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
