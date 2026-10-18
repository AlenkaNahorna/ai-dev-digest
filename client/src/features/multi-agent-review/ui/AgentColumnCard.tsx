/* One agent's result column (Columns mode, AC-35..39). Header: name, status
   badge (queued / running / done / failed as TEXT, never colour alone), score
   ring, duration · cost · tokens. Body: compact finding rows (severity label,
   title, file:line). Footer: finding count + "View trace" (mounts the existing
   RunTraceDrawer via ?trace=<run_id>). Finding actions live in the grouped list
   and in the Tabs view, so a column stays a glanceable summary. A failed or
   still-running agent never hides the other columns (failure isolation). */
"use client";

import { useTranslations } from "next-intl";
import { Badge, Button, Card, CircularScore, SeverityBadge, type Severity } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import { formatCost, formatDuration } from "../model/format";

export const STATUS_COLOR: Record<AgentColumn["status"], string> = {
  queued: "var(--text-muted)",
  running: "var(--warn)",
  done: "var(--ok)",
  failed: "var(--stale)",
};

/** "8.2s · $0.06 · 12,000 in / 1,500 out" — values that are not known yet read "—". */
export function ColumnStats({ column }: { column: AgentColumn }) {
  const t = useTranslations("multiAgent");
  const tok = (n: number | null) => (n == null ? t("results.col.unknown") : n.toLocaleString("en-US"));
  return (
    <span className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
      {formatDuration(column.duration_ms)} · {formatCost(column.cost_usd)} ·{" "}
      {t("results.col.tokensValue", { in: tok(column.tokens_in), out: tok(column.tokens_out) })}
    </span>
  );
}

export function StatusBadge({ status }: { status: AgentColumn["status"] }) {
  const t = useTranslations("multiAgent");
  return (
    <Badge dot bg="transparent" color={STATUS_COLOR[status]}>
      {t(`results.status.${status}`)}
    </Badge>
  );
}

export function AgentColumnCard({
  column,
  onViewTrace,
}: {
  column: AgentColumn;
  onViewTrace: (runId: string) => void;
}) {
  const t = useTranslations("multiAgent");

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <strong style={{ fontSize: 14 }}>{column.agent_name}</strong>
          <StatusBadge status={column.status} />
        </div>
        {column.score != null && column.status === "done" && <CircularScore score={column.score} size={38} stroke={4} />}
      </div>

      <ColumnStats column={column} />

      {column.status === "failed" ? (
        <p role="status" style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)" }}>
          {t("results.failedColumn")}
        </p>
      ) : column.status === "queued" || column.status === "running" ? (
        <p role="status" style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)" }}>
          {t(column.status === "queued" ? "results.waitingQueued" : "results.waitingRunning")}
        </p>
      ) : column.findings.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)" }}>{t("results.zeroFindings")}</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {column.findings.map((f) => (
            <li
              key={f.id}
              style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 3 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <SeverityBadge severity={f.severity as Severity} compact />
                {/* Plain text: titles come from the model. */}
                <strong style={{ fontSize: 12.5 }}>{f.title}</strong>
              </div>
              <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {f.file}:{f.start_line}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
        <Button kind="ghost" size="sm" icon="Eye" onClick={() => onViewTrace(column.run_id)}>
          {t("results.viewTrace")}
        </Button>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("results.findingsCount", { count: column.findings.length })}</span>
      </div>
    </Card>
  );
}
