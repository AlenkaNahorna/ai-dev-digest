"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Skeleton } from "@devdigest/ui";
import type { PrBrief } from "@devdigest/shared";
import { s } from "./styles";

export interface BriefBannerProps {
  /** undefined while loading or after a failed load; null when none is stored. */
  brief: PrBrief | null | undefined;
  isLoading: boolean;
  /** Reading the stored brief failed (not shown as "no brief yet"). */
  isLoadError: boolean;
  onRetryLoad: () => void;
  onGenerate: () => void;
  /** A generation started from this card is running (disables Generate and refresh). */
  generating: boolean;
  /** Last failed generation, if any; a stored brief stays visible. */
  generateError: { message: string; code?: string } | null;
}

/**
 * The PR Brief card: state matrix of loading, load error, none (Generate), generating, generation
 * error (retry) and the stored summary with refresh, "updating" and the missing/partial notes.
 * Plain text only: model text is never interpreted as HTML or Markdown.
 */
export function BriefBanner({ brief, isLoading, isLoadError, onRetryLoad, onGenerate, generating, generateError }: BriefBannerProps) {
  const t = useTranslations("brief");
  if (isLoading) return <Skeleton height={96} />;
  if (isLoadError) return <ErrorState title={t("loadError.title")} body={t("loadError.body")} onRetry={onRetryLoad} />;

  const hasBrief = brief != null;
  const label = generating ? (hasBrief ? t("updating") : t("generating")) : hasBrief ? t("refresh") : generateError ? t("retry") : t("generate");
  const action = (
    <Button kind={hasBrief ? "secondary" : "primary"} size="sm" icon={hasBrief ? "RefreshCw" : "Sparkles"} loading={generating} disabled={generating} onClick={onGenerate}>
      {label}
    </Button>
  );
  // brief_model_failed: the server text already says "could not be generated", so show the generic text once.
  const errorText = generateError
    ? generateError.code === "brief_files_unavailable"
      ? t("filesUnavailable")
      : generateError.message && generateError.code !== "brief_model_failed"
        ? t("generateError", { message: generateError.message })
        : t("generateErrorGeneric")
    : null;
  const error = errorText ? <div role="alert" style={s.error}>{errorText}</div> : null;

  return (
    <section style={s.wrap} aria-label={t("title")} aria-busy={generating}>
      <div style={s.head}>
        <span style={s.sectionTitle}>{t("title")}</span>
        {generating && hasBrief && <Badge color="var(--warning, #d29922)" icon="RefreshCw">{t("updating")}</Badge>}
        <span style={s.spacer} />
        {action}
      </div>
      {brief ? (
        <>
          <p style={s.summary}>{brief.summary}</p>
          {brief.missing_inputs.length > 0 && (
            <div style={s.note}>
              {t("missingTitle")} {brief.missing_inputs.map((m) => t(`missing.${m}`)).join(" · ")}
            </div>
          )}
          {brief.partial && <div style={s.note}>{t("partial")}</div>}
        </>
      ) : (
        <>
          <div style={s.muted}>{t("unavailable")}</div>
          <div style={s.muted}>{t("unavailableHint")}</div>
        </>
      )}
      {error}
    </section>
  );
}
