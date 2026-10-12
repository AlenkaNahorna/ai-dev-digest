"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Markdown, Skeleton } from "@devdigest/ui";
import { useContextDoc } from "../api/hooks";
import { formatTokens } from "../model/attachments";

/**
 * Read-only rendered preview of one repository document. The text is untrusted
 * repo content, so it renders through the Markdown `safe` mode: no raw HTML, no
 * images/remote content, only web/mail links.
 */
export function ContextDocPreview({ repoId, path, showUsage = false }: { repoId: string; path: string; showUsage?: boolean }) {
  const t = useTranslations("context");
  const { data, isLoading, isError, refetch } = useContextDoc(repoId, path);

  if (isLoading) {
    return (
      <div aria-busy="true" aria-label={t("preview.loading")} style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
        <Skeleton height={22} width={260} />
        <Skeleton height={160} />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <ErrorState title={t("preview.loadError")} body={t("preview.loadErrorBody")} onRetry={() => void refetch()} />
    );
  }
  return (
    <article aria-label={path} style={{ padding: 24 }}>
      <header style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
        <h2 className="mono" style={{ fontSize: 15, fontWeight: 650, wordBreak: "break-all" }}>
          {data.path}
        </h2>
        {data.type && <Badge mono>{data.type}</Badge>}
        <Badge mono>{t("preview.tokens", { count: formatTokens(data.tokens) })}</Badge>
        {showUsage && <Badge color="var(--accent-text)">{t("usedBy", { count: data.used_by_agents })}</Badge>}
      </header>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>{t("preview.readOnly")}</p>
      <Markdown safe>{data.content}</Markdown>
    </article>
  );
}
