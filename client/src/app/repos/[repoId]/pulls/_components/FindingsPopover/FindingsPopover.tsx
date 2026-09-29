"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CategoryTag, ConfidenceNum, Markdown, MonoLink, SeverityBadge, type Category, type Severity } from "@devdigest/ui";
import { usePrReviews } from "@/lib/hooks/reviews";
import { visibleFindings } from "@/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/helpers";
import { lineLabel } from "@/app/repos/[repoId]/pulls/[number]/_components/FindingCard/helpers";
import type { PrMeta } from "@/lib/types";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import { latestReviewsPerAgent } from "@/features/reviews/model/rollups";

export function FindingsPopover({ pr, findings: providedFindings }: { pr?: PrMeta; findings?: FindingRecord[] }) {
  const t = useTranslations("common");
  const { data: reviews, isLoading } = usePrReviews(pr?.id);
  const latestReviews = reviews ? latestReviewsPerAgent(reviews) : [];
  const findings = visibleFindings(
    providedFindings ?? latestReviews.flatMap((review) => review.findings),
    false,
  );
  const loading = providedFindings == null && isLoading;

  return (
    <div
      role="dialog"
      aria-label={t("findingsPopover.aria", { count: findings.length })}
      style={{ position: "absolute", zIndex: 20, top: "calc(100% + 8px)", left: -8, width: 360, maxHeight: 360, overflow: "auto", padding: "12px 14px", border: "1px solid var(--border-strong)", borderRadius: 9, background: "var(--bg-elevated)", boxShadow: "var(--shadow-modal)", cursor: "default" }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 10 }}>
        {loading ? t("findingsPopover.loading") : t("findingsPopover.count", { count: findings.length })}
      </div>
      {!loading && findings.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("findingsPopover.empty")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {findings.map((f) => (
            <div key={f.id} style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                <SeverityBadge severity={f.severity as Severity} compact />
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.title}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, fontSize: 11 }}>
                <CategoryTag category={f.category as Category} />
                <MonoLink href={undefined}>{f.file}:{lineLabel(f)}</MonoLink>
                <ConfidenceNum value={f.confidence} />
              </div>
              <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.4, color: "var(--text-secondary)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                <Markdown>{f.rationale}</Markdown>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
