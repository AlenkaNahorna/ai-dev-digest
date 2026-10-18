"use client";

import React from "react";
import { Badge, Card, EmptyState, ErrorState } from "@devdigest/ui";
import { formatCost } from "@/lib/format-cost";
import { formatDuration, prLabel, shortTime, toneColors, verdictDisplay } from "../lib/format";
import type { CiRunRow } from "../model/types";

const th: React.CSSProperties = {
  textAlign: "left",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.3,
  color: "var(--text-muted)",
  padding: "8px 10px",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
};
const td: React.CSSProperties = { padding: "8px 10px", fontSize: 13, borderBottom: "1px solid var(--border)" };

/**
 * Presentational, read-only CI Runs list (props in, callbacks out). State
 * matrices (loading / error / empty / populated) are testable without mocking
 * data hooks or navigation (client/INSIGHTS.md 2026-10-11). No row-level
 * Accept/Dismiss — list previews are read-only (client/INSIGHTS.md 2026-09-21).
 */
export function CiRunsView({
  runs,
  isLoading,
  isError,
  onRetry,
}: {
  runs: CiRunRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  if (isLoading) return <div style={{ padding: 4 }}>Loading CI runs…</div>;
  if (isError) return <ErrorState title="Couldn't load CI runs." onRetry={onRetry} />;
  if (!runs || runs.length === 0) {
    return (
      <EmptyState
        icon="Workflow"
        title="No CI runs yet"
        body="When an exported agent runs on a pull request, its review will show up here."
      />
    );
  }

  return (
    <Card>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Repository", "PR", "Agent", "Verdict", "Findings", "Cost", "Duration", "When", ""].map((h, i) => (
              <th key={h || `col-${i}`} style={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const v = verdictDisplay(run.verdict ?? run.status);
            const colors = toneColors(v.tone);
            return (
              <tr key={run.id}>
                <td style={{ ...td, fontFamily: "var(--font-mono, monospace)" }}>{run.repo ?? "—"}</td>
                <td style={td}>
                  {run.repo && run.pr_number != null ? (
                    <a
                      href={`https://github.com/${run.repo}/pull/${run.pr_number}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "var(--accent)" }}
                    >
                      {prLabel(run.pr_number)}
                    </a>
                  ) : (
                    prLabel(run.pr_number)
                  )}
                </td>
                <td style={td}>{run.agent ?? "—"}</td>
                <td style={td}>
                  <Badge color={colors.color} bg={colors.bg}>
                    {v.label}
                  </Badge>
                </td>
                <td style={td}>
                  {run.findings_count ?? "—"}
                  {run.findings_count ? (
                    <span style={{ color: "var(--text-muted)", fontSize: 11, marginLeft: 6 }}>
                      {[
                        run.critical ? `${run.critical} crit` : null,
                        run.warning ? `${run.warning} warn` : null,
                        run.suggestion ? `${run.suggestion} sugg` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  ) : null}
                </td>
                <td style={td}>{formatCost(run.cost_usd)}</td>
                <td style={td}>{formatDuration(null, run.duration_s)}</td>
                <td style={{ ...td, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{shortTime(run.ran_at)}</td>
                <td style={td}>
                  {run.github_url ? (
                    <a
                      href={run.github_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open the Actions job for run ${run.id}`}
                      style={{ color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      Actions job
                    </a>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
