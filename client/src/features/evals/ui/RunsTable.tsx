"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Checkbox } from "@devdigest/ui";
import type { EvalBatchSummary } from "@devdigest/shared";
import { formatCost } from "@/lib/format-cost";
import { pct, shortTime, versionLabel } from "../lib/format";
import { CompareModal } from "./CompareModal";

/** Run history with two-row selection and Compare (AC-34..AC-36). */
export function RunsTable({ batches }: { batches: EvalBatchSummary[] }) {
  const t = useTranslations("eval");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [open, setOpen] = React.useState(false);
  const toggle = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 2 ? [cur[1]!, id] : [...cur, id]));

  if (batches.length === 0) {
    return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("pipeline.history.empty")}</div>;
  }
  // Compare is chronological: older run → newer run.
  const ordered = batches.filter((b) => selected.includes(b.batch_id)).sort((x, y) => x.ran_at.localeCompare(y.ran_at));
  const canCompare = ordered.length === 2;
  const th: React.CSSProperties = { textAlign: "left", fontSize: 11, color: "var(--text-muted)", fontWeight: 600, padding: "8px 10px" };
  const td: React.CSSProperties = { padding: "8px 10px", fontSize: 13 };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {selected.length > 0 ? t("pipeline.history.selected", { count: selected.length }) : t("pipeline.history.selectTwo")}
        </span>
        <Button kind="primary" size="sm" icon="GitMerge" disabled={!canCompare} onClick={() => setOpen(true)}>
          {t("pipeline.history.compare")}
        </Button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8 }}>
        <thead>
          <tr>
            <th style={th} />
            {(["ranAt", "version", "recall", "precision", "citation", "pass", "cost"] as const).map((k) => (
              <th key={k} style={th}>
                {t(`pipeline.history.columns.${k}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.batch_id} data-testid="eval-run-row" style={{ borderTop: "1px solid var(--border)" }}>
              <td style={td}>
                <Checkbox
                  checked={selected.includes(b.batch_id)}
                  onChange={() => toggle(b.batch_id)}
                  ariaLabel={t("pipeline.history.columns.select", { time: shortTime(b.ran_at) })}
                />
              </td>
              <td style={{ ...td, fontFamily: "var(--font-mono, monospace)" }}>{shortTime(b.ran_at)}</td>
              <td style={{ ...td, color: "var(--accent)" }}>{versionLabel(b.agent_version)}</td>
              <td style={td}>{pct(b.recall)}</td>
              <td style={td}>{pct(b.precision)}</td>
              <td style={td}>{pct(b.citation_accuracy)}</td>
              <td style={{ ...td, fontWeight: 600 }}>
                {b.cases_passed}/{b.cases_total}
              </td>
              <td style={td}>{formatCost(b.cost_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && canCompare && <CompareModal a={ordered[0]!} b={ordered[1]!} onClose={() => setOpen(false)} />}
    </div>
  );
}
