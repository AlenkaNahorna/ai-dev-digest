/* A single finding, rendered as PLAIN TEXT (security A05: model-derived output
   is never interpreted as markup/HTML). Severity is conveyed by the text label
   in SeverityBadge, not colour alone. */
"use client";

import { useTranslations } from "next-intl";
import { SeverityBadge, type Severity } from "@devdigest/ui";
import type { AgentColumnFinding } from "@devdigest/shared";

export function FindingBody({ finding, showAgent }: { finding: AgentColumnFinding; showAgent?: string | null }) {
  const t = useTranslations("multiAgent");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <SeverityBadge severity={finding.severity as Severity} compact />
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{finding.category}</span>
        {showAgent && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>· {showAgent}</span>}
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {t("finding.confidence", { value: finding.confidence.toFixed(2) })}
        </span>
      </div>
      {/* Plain text: title/rationale/suggestion come from the model. */}
      <strong style={{ fontSize: 13 }}>{finding.title}</strong>
      <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
        {finding.file}:{finding.start_line}
        {finding.end_line !== finding.start_line ? `-${finding.end_line}` : ""}
      </span>
      {finding.rationale && <p style={{ margin: 0, fontSize: 12.5, whiteSpace: "pre-wrap" }}>{finding.rationale}</p>}
      {finding.suggestion && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>
          {t("finding.suggestedFix")}: {finding.suggestion}
        </p>
      )}
    </div>
  );
}
