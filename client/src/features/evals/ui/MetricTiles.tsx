"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, Sparkline } from "@devdigest/ui";
import type { EvalBatchSummary } from "@devdigest/shared";
import { deltaPoints, pct, type DeltaTone } from "../lib/format";

const TONE: Record<DeltaTone, string> = {
  up: "var(--ok)",
  down: "var(--crit)",
  flat: "var(--text-muted)",
  none: "var(--text-muted)",
};

type Key = "recall" | "precision" | "citation_accuracy";

/** Recall / precision / citation tiles of the latest run with the delta to the previous one (AC-32). */
export function MetricTiles({ batches }: { batches: EvalBatchSummary[] }) {
  const t = useTranslations("eval");
  const latest = batches[0];
  const previous = batches[1];
  if (!latest) {
    return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("pipeline.tab.noRuns")}</div>;
  }
  const tiles: { key: Key; label: string; color: string }[] = [
    { key: "recall", label: t("pipeline.metrics.recall"), color: "var(--accent)" },
    { key: "precision", label: t("pipeline.metrics.precision"), color: "var(--ok)" },
    { key: "citation_accuracy", label: t("pipeline.metrics.citation"), color: "var(--warn)" },
  ];
  const trend = (k: Key) =>
    [...batches]
      .reverse()
      .map((b) => b[k])
      .filter((v): v is number => v !== null);
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {tiles.map(({ key, label, color }) => {
        const cur = latest[key];
        const prev = previous?.[key] ?? null;
        const d = deltaPoints(cur !== null && prev !== null ? cur - prev : null);
        return (
          <Card key={key} style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, color: "var(--text-muted)" }}>
              {label.toUpperCase()}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
              <span data-testid={`metric-${key}`} style={{ fontSize: 26, fontWeight: 600, color }}>
                {pct(cur)}
              </span>
              <span
                data-testid={`delta-${key}`}
                title={t("pipeline.tab.vsPrevious")}
                style={{ fontSize: 12, color: TONE[d.tone] }}
              >
                {d.text}
              </span>
            </div>
            <div style={{ marginTop: 6 }}>
              <Sparkline data={trend(key)} color={color} w={120} h={22} />
            </div>
          </Card>
        );
      })}
      <Card style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, color: "var(--text-muted)" }}>
          {t("pipeline.metrics.passed").toUpperCase()}
        </div>
        <div data-testid="metric-passed" style={{ fontSize: 26, fontWeight: 600, marginTop: 6 }}>
          {latest.cases_passed}/{latest.cases_total}
        </div>
      </Card>
    </div>
  );
}
