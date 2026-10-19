/* CostSection — where the tokens and the money went for ONE run: the review call
   (this run's own numbers) and the shared intent-classifier call, which is made
   once per review batch and is therefore NOT part of the run's cost above. */
"use client";

import { useTranslations } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import { formatCost } from "@/lib/format-cost";
import { TraceSection } from "../TraceSection";

const n = (v: number) => v.toLocaleString("en-US");

export function CostSection({ trace }: { trace: RunTrace }) {
  const t = useTranslations("runs");
  const { stats, intent_call: intent } = trace;
  return (
    <TraceSection icon="Gauge" title={t("trace.cost.title")} defaultOpen={false}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5 }}>
        <span className="mono">
          {t("trace.cost.review", { in: n(stats.tokens_in), out: n(stats.tokens_out), cost: formatCost(stats.cost_usd) })}
        </span>
        {intent &&
          (intent.cached ? (
            <span style={{ color: "var(--text-muted)" }}>{t("trace.cost.intentCached")}</span>
          ) : (
            <span className="mono">
              {t("trace.cost.intent", { in: n(intent.tokens_in), out: n(intent.tokens_out), cost: formatCost(intent.cost_usd) })}
            </span>
          ))}
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("trace.cost.note")}</span>
      </div>
    </TraceSection>
  );
}
