"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { PrBrief, Risk } from "@devdigest/shared";
import { s } from "./styles";

const SEVERITY_COLOR = { high: "var(--danger, #f85149)", medium: "var(--warning, #d29922)", low: "var(--text-tertiary)" } as const;

export interface RiskAreasProps {
  /** The brief's whole `risks` part: read here, inside the error boundary, so a malformed value is contained. */
  risks: PrBrief["risks"];
}

/**
 * Model-written risks: title and files of each. Severity is shown by color and by text, so it never
 * depends on color alone. All model text is rendered as React text nodes (no HTML or Markdown).
 */
export function RiskAreas({ risks: part }: RiskAreasProps) {
  const t = useTranslations("brief");
  const risks: readonly Risk[] = part.risks;
  return (
    <section style={s.wrap} aria-label={t("riskAreas")}>
      <span style={s.sectionTitle}>{t("riskAreas")}</span>
      {risks.length === 0 ? (
        <div style={s.muted}>{t("noRisks")}</div>
      ) : (
        <ul style={s.list}>
          {risks.map((risk, i) => (
            <li key={`${risk.title}-${i}`} style={s.item}>
              <div style={s.itemHead}>
                <Badge dot color={SEVERITY_COLOR[risk.severity]}>{t(`severity.${risk.severity}`)}</Badge>
                <span style={s.itemTitle}>{risk.title}</span>
              </div>
              <div style={s.fileRefs}>
                {risk.file_refs.map((file) => (
                  <span key={file} style={s.mono}>{file}</span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
