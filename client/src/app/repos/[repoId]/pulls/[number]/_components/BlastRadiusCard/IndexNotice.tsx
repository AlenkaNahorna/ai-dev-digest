"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@devdigest/ui";
import type { BlastRadius } from "@devdigest/shared";
import { incompleteMessageKey, type BlastIndexInfo } from "./helpers";
import { s } from "./styles";

export interface IndexNoticeProps {
  data: BlastRadius;
  index: BlastIndexInfo | undefined;
}

/** "Index incomplete" mark: why callers may be missing, plus the resync action and its outcome. */
export function IndexNotice({ data, index }: IndexNoticeProps) {
  const t = useTranslations("blast");
  return (
    <div role="status" style={s.notice}>
      <div style={s.noticeActions}>
        <Badge icon="AlertTriangle" color="var(--warning, #d29922)" bg="rgba(210, 153, 34, 0.14)">{t("incomplete")}</Badge>
        {index?.onResync && (
          <Button kind="secondary" size="sm" icon="RefreshCw" loading={index.resyncing} disabled={index.resyncing} onClick={index.onResync}>
            {index.resyncing ? t("resyncing") : t("resync")}
          </Button>
        )}
      </div>
      <span style={s.noticeText}>{t(incompleteMessageKey(data, index?.status, index?.reason))}</span>
      {index?.resyncError && <span role="alert" style={s.noticeError}>{t("resyncFailed")}</span>}
      {index?.timedOut && <span style={s.noticeText}>{t("resyncTimeout")}</span>}
    </div>
  );
}
