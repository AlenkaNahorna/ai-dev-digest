/* GroundingSection — explains the "N/M passed" number: every finding the model
   produced and what the post-model gates decided (kept / dropped + why).
   Titles and file:line only — no prompt or diff text. Hidden for traces written
   before `grounding_detail` existed. Plain text; model titles are never markup. */
"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { RunTrace } from "@devdigest/shared";
import { TraceSection } from "../TraceSection";

export function GroundingSection({ trace }: { trace: RunTrace }) {
  const t = useTranslations("runs");
  const detail = trace.grounding_detail;
  if (!detail) return null;

  const kept = detail.filter((d) => d.kept).length;
  return (
    <TraceSection
      icon="AlertOctagon"
      title={t("trace.grounding.title")}
      right={<Badge color="var(--text-muted)">{t("trace.grounding.summary", { kept, total: detail.length })}</Badge>}
    >
      <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--text-muted)" }}>{t("trace.grounding.explain")}</p>
      {detail.length === 0 ? (
        <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{t("trace.grounding.none")}</span>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {detail.map((d, i) => (
            <li key={i} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12.5 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Badge
                  color={d.kept ? "var(--ok)" : "var(--warn)"}
                  bg={d.kept ? "var(--ok-bg)" : "var(--warn-bg)"}
                  icon={d.kept ? "Check" : "X"}
                >
                  {d.kept ? t("trace.grounding.kept") : t("trace.grounding.dropped")}
                </Badge>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t(`trace.grounding.gate.${d.gate}`)}</span>
                <strong>{d.title}</strong>
              </span>
              <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {d.file}:{d.start_line}
                {d.end_line !== d.start_line ? `-${d.end_line}` : ""}
              </span>
              {!d.kept && d.reason && <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{d.reason}</span>}
            </li>
          ))}
        </ul>
      )}
    </TraceSection>
  );
}
