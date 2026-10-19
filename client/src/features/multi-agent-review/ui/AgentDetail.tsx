/* Tabs + detail mode body (AC-41..45): a header card for the selected agent
   (score, summary, duration · cost · tokens, "View trace") and its findings as
   expandable cards (category, file:line, confidence, description, suggested fix)
   with Accept / Dismiss and the disabled placeholders. A finding that another
   agent flagged at the same place says so ("also flagged by …"), taken from the
   server-computed groups; every original stays visible. Plain text throughout. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Card, CircularScore, Icon, SeverityBadge, type Severity } from "@devdigest/ui";
import type { AgentColumn, AgentColumnFinding } from "@devdigest/shared";
import { FindingActions } from "./FindingActions";
import { ColumnStats, StatusBadge } from "./AgentColumnCard";

function ExpandableFinding({
  finding,
  prId,
  alsoFlaggedBy,
}: {
  finding: AgentColumnFinding;
  prId: string | null;
  alsoFlaggedBy: string[];
}) {
  const t = useTranslations("multiAgent");
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();

  return (
    <Card pad={false} style={{ overflow: "hidden" }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 14px",
          background: "none",
          border: "none",
          color: "inherit",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <SeverityBadge severity={finding.severity as Severity} compact />
        <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 13.5, overflowWrap: "anywhere" }}>{finding.title}</strong>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{finding.category}</span>
          </span>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)", overflowWrap: "anywhere" }}>
            {finding.file}:{finding.start_line}
            {finding.end_line !== finding.start_line ? `-${finding.end_line}` : ""} ·{" "}
            {t("finding.confidencePct", { value: Math.round(finding.confidence * 100) })}
          </span>
        </span>
        {open ? <Icon.ChevronDown size={14} /> : <Icon.ChevronRight size={14} />}
      </button>

      {open && (
        <div id={panelId} style={{ borderTop: "1px solid var(--border)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          {alsoFlaggedBy.length > 0 && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("finding.alsoFlaggedBy", { agents: alsoFlaggedBy.join(", ") })}
            </span>
          )}
          {finding.rationale && <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>{finding.rationale}</p>}
          {finding.suggestion && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)" }}>
                {t("finding.suggestedFixHeading")}
              </span>
              <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>{finding.suggestion}</p>
            </div>
          )}
          <FindingActions findingIds={[finding.id]} prId={prId} state={finding.state} />
        </div>
      )}
    </Card>
  );
}

export function AgentDetail({
  column,
  prId,
  alsoFlaggedBy,
  onViewTrace,
}: {
  column: AgentColumn;
  prId: string | null;
  /** finding id → names of the OTHER agents that flagged the same place. */
  alsoFlaggedBy: Map<string, string[]>;
  onViewTrace: (runId: string) => void;
}) {
  const t = useTranslations("multiAgent");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {column.score != null && column.status === "done" ? <CircularScore score={column.score} size={52} stroke={5} /> : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 15 }}>{column.agent_name}</strong>
            <StatusBadge status={column.status} />
          </div>
          {/* Plain text: the summary is model output. */}
          {column.summary && <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{column.summary}</p>}
          {column.status === "failed" && <p role="status" style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)" }}>{t("results.failedColumn")}</p>}
          <ColumnStats column={column} />
        </div>
        <Button kind="ghost" size="sm" icon="Eye" onClick={() => onViewTrace(column.run_id)}>
          {t("results.viewTrace")}
        </Button>
      </Card>

      {column.status === "done" && column.findings.length === 0 && (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)" }}>{t("results.zeroFindings")}</p>
      )}
      {column.findings.map((f) => (
        <ExpandableFinding key={f.id} finding={f} prId={prId} alsoFlaggedBy={alsoFlaggedBy.get(f.id) ?? []} />
      ))}
    </div>
  );
}
