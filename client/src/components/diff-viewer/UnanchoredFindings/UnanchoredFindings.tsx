/* UnanchoredFindings — footer list for findings whose line is not in this
   file's patch (never dropped). Mirrors OutdatedComments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import { cs } from "../comments";
import type { DiffFindingApi } from "../findings";

export function UnanchoredFindings({
  findings,
  findingApi,
}: {
  findings: FindingRecord[];
  findingApi: DiffFindingApi;
}) {
  const t = useTranslations("prReview");
  if (findings.length === 0 || !findingApi.showCards) return null;
  return (
    <div style={cs.outdatedWrap}>
      <span style={cs.outdatedTitle}>{t("smartDiff.unanchoredTitle", { count: findings.length })}</span>
      {findings.map((f) => (
        <React.Fragment key={f.id}>{findingApi.renderFinding(f)}</React.Fragment>
      ))}
    </div>
  );
}
