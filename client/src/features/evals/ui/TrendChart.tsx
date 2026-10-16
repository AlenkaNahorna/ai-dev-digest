"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { LineChart } from "@devdigest/ui";
import type { EvalBatchSummary } from "@devdigest/shared";

/** Recall / precision / citation over the run history (oldest → newest). Missing values carry the previous point forward. */
export function TrendChart({ batches }: { batches: EvalBatchSummary[] }) {
  const t = useTranslations("eval");
  const ordered = [...batches].reverse();
  const series = (pick: (b: EvalBatchSummary) => number | null) => {
    let last = 0;
    return ordered.map((b) => (last = pick(b) ?? last));
  };
  return (
    <LineChart
      w={900}
      h={220}
      yMin={0}
      yMax={1}
      series={[
        { name: t("dashboard.legend.recall"), color: "var(--accent)", data: series((b) => b.recall) },
        { name: t("dashboard.legend.precision"), color: "var(--ok)", data: series((b) => b.precision) },
        { name: t("dashboard.legend.citation"), color: "var(--warn)", data: series((b) => b.citation_accuracy) },
      ]}
    />
  );
}
