"use client";

import React from "react";
import { Badge, Button, Card, EmptyState, ErrorState, Icon, SelectInput } from "@devdigest/ui";
import {
  FAIL_ON_OPTIONS,
  POST_AS_LABELS,
  relativeTime,
  toneColors,
  verdictDisplay,
  workflowVersionState,
} from "../lib/format";
import type { CiHistoryRow, CiInstallationRow } from "../model/types";

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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 style={{ fontSize: 13, margin: 0, color: "var(--text-secondary, var(--text-muted))" }}>{children}</h4>;
}

/**
 * Presentational CI tab: props in, callbacks out. State matrices (loading /
 * error / empty / populated) are testable without mocking data hooks or
 * navigation (client/INSIGHTS.md 2026-10-11).
 *
 * Shows: installations (repo, target, workflow version, latest verdict), the
 * agent's "Fail CI on" gate, and the recent-run history across its repos.
 */
export function CiTabView({
  installations,
  history,
  isLoading,
  isError,
  failOn,
  failOnSaving,
  failOnError,
  onRetry,
  onAddToCi,
  onUpdateConfig,
  onFailOnChange,
}: {
  installations: CiInstallationRow[] | undefined;
  history: CiHistoryRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  failOn: string | undefined;
  failOnSaving?: boolean;
  failOnError?: boolean;
  onRetry: () => void;
  onAddToCi: () => void;
  /** Re-open the wizard for an installed repo to push refreshed files. */
  onUpdateConfig: (repo: string) => void;
  onFailOnChange: (v: string) => void;
}) {
  const count = installations?.length ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>CI deployment</h3>
          {count > 0 && (
            <Badge color="var(--ok)" bg="var(--ok-bg, var(--bg-hover))">
              Active in {count} {count === 1 ? "repo" : "repos"}
            </Badge>
          )}
        </div>
        <Button
          kind="secondary"
          icon="RefreshCw"
          disabled={count === 0}
          onClick={() => installations?.[0] && onUpdateConfig(installations[0].repo)}
        >
          Update CI config
        </Button>
        <Button kind="primary" icon="Plus" onClick={onAddToCi}>
          Add to CI
        </Button>
      </div>

      {isLoading ? (
        <div>Loading installations…</div>
      ) : isError ? (
        <ErrorState title="Couldn't load CI installations." onRetry={onRetry} />
      ) : count === 0 ? (
        <EmptyState
          icon="Workflow"
          title="Not installed in any repository yet"
          body="Use Add to CI to export this agent into a repository and open a pull request."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {installations!.map((inst) => {
            const v = verdictDisplay(inst.latest_verdict);
            const colors = toneColors(v.tone);
            const wf = workflowVersionState(inst.workflow_version, inst.latest_workflow_version);
            return (
              <Card key={inst.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", flexWrap: "wrap" }}>
                  <Icon.GitBranch size={15} style={{ color: "var(--text-muted)" }} />
                  <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 13, flex: 1, minWidth: 160 }}>
                    {inst.repo}
                  </span>
                  <Badge color="var(--text-secondary, var(--text-muted))" icon="Workflow">
                    GitHub Actions
                  </Badge>
                  <Badge color={wf.outdated ? "var(--warn, var(--accent))" : "var(--text-muted)"} mono>
                    {wf.label}
                    {wf.outdated ? ` · v${inst.latest_workflow_version} available` : ""}
                  </Badge>
                  {inst.post_as && <Badge color="var(--text-muted)">{POST_AS_LABELS[inst.post_as] ?? inst.post_as}</Badge>}
                  <Badge color={colors.color} bg={colors.bg}>
                    {v.label}
                  </Badge>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 72, textAlign: "right" }}>
                    {relativeTime(inst.latest_ran_at)}
                  </span>
                  {inst.pr_url && (
                    <a
                      href={inst.pr_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open the export PR for ${inst.repo}`}
                      style={{ fontSize: 12, color: "var(--accent)" }}
                    >
                      PR
                    </a>
                  )}
                  <Button kind="ghost" size="sm" onClick={() => onUpdateConfig(inst.repo)}>
                    Update
                  </Button>
                </div>
              </Card>
            );
          })}
          <button
            type="button"
            onClick={onAddToCi}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "12px 14px",
              border: "1px dashed var(--border-strong)",
              borderRadius: 10,
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              font: "inherit",
              fontSize: 13,
            }}
          >
            <Icon.Plus size={14} /> Add repository
          </button>
        </div>
      )}

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SectionTitle>Fail CI on</SectionTitle>
        <div style={{ maxWidth: 360 }}>
          <SelectInput
            value={failOn ?? "critical"}
            onChange={onFailOnChange}
            options={FAIL_ON_OPTIONS}
            mono={false}
            ariaLabel="Fail CI on"
          />
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {failOnSaving ? "Saving… " : ""}
          {failOnError ? (
            <span role="alert" style={{ color: "var(--crit)" }}>
              Couldn&apos;t save this setting.{" "}
            </span>
          ) : null}
          When findings reach this severity the runner exits non-zero and the check fails. The value lives in the exported
          manifest — use <strong>Update CI config</strong> to push a change to the repo. To actually block merges, make the
          check a <strong>required status check</strong> in the repo&apos;s branch protection / ruleset.
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SectionTitle>History</SectionTitle>
        {!history || history.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>No CI runs for this agent yet.</div>
        ) : (
          <Card>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Repository", "PR", "Verdict", "Findings", "When", ""].map((h, i) => (
                    <th key={h || `c${i}`} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((run) => {
                  const v = verdictDisplay(run.verdict ?? run.status);
                  const colors = toneColors(v.tone);
                  return (
                    <tr key={run.id}>
                      <td style={{ ...td, fontFamily: "var(--font-mono, monospace)" }}>{run.repo ?? "—"}</td>
                      <td style={td}>{run.pr_number != null ? `#${run.pr_number}` : "—"}</td>
                      <td style={td}>
                        <Badge color={colors.color} bg={colors.bg}>
                          {v.label}
                        </Badge>
                      </td>
                      <td style={td}>{run.findings_count ?? "—"}</td>
                      <td style={{ ...td, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                        {relativeTime(run.ran_at)}
                      </td>
                      <td style={td}>
                        {run.github_url ? (
                          <a
                            href={run.github_url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open the Actions job for run ${run.id}`}
                            style={{ color: "var(--accent)" }}
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
        )}
      </section>
    </div>
  );
}
