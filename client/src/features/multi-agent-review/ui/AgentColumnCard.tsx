/* One agent's result column: status badge (queued/running/done/failed as TEXT),
   score, duration, cost, its finding cards + count, and a "View trace" action
   that mounts the existing RunTraceDrawer via ?trace=<run_id>. */
"use client";

import { useTranslations } from "next-intl";
import { Badge, Button, Card } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import { formatCost, formatDuration, formatScore } from "../model/format";
import { FindingBody } from "./FindingBody";
import { FindingActions } from "./FindingActions";

const STATUS_COLOR: Record<AgentColumn["status"], string> = {
  queued: "var(--text-muted)",
  running: "var(--warn)",
  done: "var(--ok)",
  failed: "var(--stale)",
};

export function AgentColumnCard({
  column,
  prId,
  onViewTrace,
}: {
  column: AgentColumn;
  prId: string | null;
  onViewTrace: (runId: string) => void;
}) {
  const t = useTranslations("multiAgent");
  const statusLabel = t(`results.status.${column.status}`);

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 300 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 14 }}>{column.agent_name}</strong>
        <Badge dot bg="transparent" color={STATUS_COLOR[column.status]}>
          {statusLabel}
        </Badge>
      </div>

      <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-secondary)" }}>
        <span>{t("results.col.score")}: {formatScore(column.score)}</span>
        <span>{t("results.col.duration")}: {formatDuration(column.duration_ms)}</span>
        <span>{t("results.col.cost")}: {formatCost(column.cost_usd)}</span>
        <span>
          {t("results.col.tokens")}:{" "}
          {t("results.col.tokensValue", {
            in: column.tokens_in == null ? t("results.col.unknown") : String(column.tokens_in),
            out: column.tokens_out == null ? t("results.col.unknown") : String(column.tokens_out),
          })}
        </span>
      </div>

      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
        {t("results.findingsCount", { count: column.findings.length })}
      </div>

      {column.findings.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)" }}>{t("results.zeroFindings")}</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {column.findings.map((f) => (
            <li key={f.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              <FindingBody finding={f} />
              <FindingActions findingIds={[f.id]} prId={prId} state={f.state} />
            </li>
          ))}
        </ul>
      )}

      <div>
        <Button kind="ghost" size="sm" icon="Eye" onClick={() => onViewTrace(column.run_id)}>
          {t("results.viewTrace")}
        </Button>
      </div>
    </Card>
  );
}
