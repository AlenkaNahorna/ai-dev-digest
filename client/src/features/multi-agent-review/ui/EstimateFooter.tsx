/* Picker estimate footer (AC-11..16). Always labelled approximate; shows a
   "no estimate" state when no selected agent has a usable prior-run sample. */
"use client";

import { useTranslations } from "next-intl";
import type { EstimateSummary } from "../model/estimate";
import { formatCost, formatDuration } from "../model/format";

export function EstimateFooter({ summary, loading }: { summary: EstimateSummary; loading: boolean }) {
  const t = useTranslations("multiAgent");

  if (loading) {
    return <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{t("estimate.label")}</p>;
  }

  if (!summary.hasEstimate) {
    return <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{t("estimate.none")}</p>;
  }

  const duration = formatDuration(summary.totalDurationMs);
  const cost = formatCost(summary.totalCostUsd);
  const total =
    summary.totalDurationMs != null && summary.totalCostUsd != null
      ? t("estimate.total", { duration, cost })
      : summary.totalDurationMs != null
        ? t("estimate.totalTimeOnly", { duration })
        : t("estimate.totalCostOnly", { cost });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{total}</span>
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("estimate.label")}</span>
      {summary.missingSampleCount > 0 && (
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {t("estimate.someMissing", { count: summary.missingSampleCount })}
        </span>
      )}
    </div>
  );
}
