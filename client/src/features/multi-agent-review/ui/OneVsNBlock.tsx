/* "1 vs N" block (AC-48..52, D9): the measured totals of this review next to a
   prior single-agent run of one of its agents on the same PR ("no baseline" when
   there is none). Nothing is stored and no N-times expectation is shown: the
   ratio column is the real measurement, with a note on why it can differ from N
   (caching, shared diff preparation, answer length). Unknown costs are excluded
   from the total and said so — never counted as $0. */
"use client";

import { useTranslations } from "next-intl";
import { Card } from "@devdigest/ui";
import type { MultiAgentComparison, MultiAgentRunStatus } from "@devdigest/shared";
import { comparisonRows, formatRatio, formatTokenCount } from "../model/comparison";
import { formatCost, formatDuration } from "../model/format";

export function OneVsNBlock({ comparison, status }: { comparison: MultiAgentComparison; status: MultiAgentRunStatus }) {
  const t = useTranslations("multiAgent");

  if (comparison.agents_done === 0) {
    return (
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>{t("comparison.heading")}</h2>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)" }}>{t("comparison.pending")}</p>
      </section>
    );
  }

  const rows = comparisonRows(comparison);
  const b = comparison.baseline;
  const fmt = (key: "tokens" | "cost" | "time", v: number | null): string =>
    key === "tokens" ? formatTokenCount(v) : key === "cost" ? formatCost(v) : formatDuration(v);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 style={{ fontSize: 15, margin: 0 }}>{t("comparison.heading")}</h2>
      <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {status === "running" && <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{t("comparison.partial")}</p>}

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: 11.5 }}>
              <th scope="col" style={{ padding: "4px 8px 6px 0", fontWeight: 600 }} />
              <th scope="col" style={{ padding: "4px 8px 6px", fontWeight: 600 }}>
                {t("comparison.thisReview", { count: comparison.agents_total })}
              </th>
              <th scope="col" style={{ padding: "4px 8px 6px", fontWeight: 600 }}>
                {b ? t("comparison.baseline", { agent: b.agent_name ?? t("results.col.unknown") }) : t("comparison.baselineHeading")}
              </th>
              <th scope="col" style={{ padding: "4px 0 6px 8px", fontWeight: 600 }}>{t("comparison.measuredRatio")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} style={{ borderTop: "1px solid var(--border)" }}>
                <th scope="row" style={{ padding: "8px 8px 8px 0", textAlign: "left", fontWeight: 500 }}>
                  {t(`comparison.row.${r.key}`)}
                </th>
                <td className="mono" style={{ padding: "8px" }}>{fmt(r.key, r.review)}</td>
                <td className="mono" style={{ padding: "8px", color: b ? undefined : "var(--text-muted)" }}>
                  {b ? fmt(r.key, r.baseline) : t("comparison.noBaseline")}
                </td>
                <td className="mono" style={{ padding: "8px 0 8px 8px" }}>{formatRatio(r.ratio)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
          <span>
            {t("comparison.sequential", {
              sum: formatDuration(comparison.sequential_sum_ms),
              wall: formatDuration(comparison.wall_clock_ms),
            })}
          </span>
          {comparison.cost_unknown_agents > 0 && (
            <span>{t("comparison.unknownCost", { count: comparison.cost_unknown_agents })}</span>
          )}
          {comparison.shared_intent && (
            <span>
              {t("comparison.sharedIntent", {
                tokens: formatTokenCount(comparison.shared_intent.tokens_in + comparison.shared_intent.tokens_out),
                cost: formatCost(comparison.shared_intent.cost_usd),
                cached: comparison.shared_intent.cached ? t("comparison.cached") : "",
              })}
            </span>
          )}
          <span>{t("comparison.note")}</span>
        </div>
      </Card>
    </section>
  );
}
