"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Skeleton } from "@devdigest/ui";
import type { PrIntentRecord } from "@devdigest/shared";
import { s } from "./styles";

export interface IntentCardProps {
  /** undefined while loading; null when no intent has been derived yet. */
  intent: PrIntentRecord | null | undefined;
  loading?: boolean;
  /** Re-derive with the cheap classifier model (PR updated). */
  onRederive: () => void;
  rederiving?: boolean;
  /** Message of the last failed derive, if any. */
  errorMessage?: string | null;
}

const CONF_COLOR = { high: "var(--success, #3fb950)", medium: "var(--warning, #d29922)", low: "var(--danger, #f85149)" } as const;

/**
 * The system's understanding of the PR's goal, shown BEFORE the review results
 * so the reader can check the reviewer started from the right task. Includes
 * confidence, where the intent came from (unavailable links flagged), and a
 * re-derive action for when the PR moved on.
 */
export function IntentCard({ intent, loading, onRederive, rederiving, errorMessage }: IntentCardProps) {
  const t = useTranslations("prReview");
  if (loading) return <Skeleton height={120} />;

  const action = (
    <Button kind="secondary" size="sm" icon="RefreshCw" loading={rederiving} disabled={rederiving} onClick={onRederive}>
      {rederiving ? t("intent.deriving") : intent ? t("intent.rederive") : t("intent.derive")}
    </Button>
  );
  const error = errorMessage ? <div role="alert" style={s.error}>{t("intent.error", { message: errorMessage })}</div> : null;

  if (!intent) {
    return (
      <section style={s.wrap} aria-label={t("intent.title")}>
        <div style={s.head}>
          <span style={s.sectionTitle}>{t("intent.title")}</span>
          <span style={s.spacer} />
          {action}
        </div>
        <div style={s.muted}>{t("intent.empty")}</div>
        {error}
      </section>
    );
  }

  const color = CONF_COLOR[intent.confidence];
  const List = ({ items }: { items: string[] }) =>
    items.length === 0 ? <div style={s.muted}>{t("intent.none")}</div> : <ul style={s.list}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;

  return (
    <section style={s.wrap} aria-label={t("intent.title")}>
      <div style={s.head}>
        <span style={s.sectionTitle}>{t("intent.title")}</span>
        <Badge color={color} dot>{t(`intent.confidence.${intent.confidence}`)}</Badge>
        {intent.stale && <Badge color="var(--warning, #d29922)" icon="AlertTriangle">{t("intent.stale")}</Badge>}
        <span style={s.spacer} />
        {intent.model && <span style={s.muted}>{t("intent.model", { model: intent.model })}</span>}
        {action}
      </div>

      <p style={s.summary}>“{intent.summary}”</p>

      <div style={s.cols}>
        <div>
          <div style={s.colTitle("var(--success, #3fb950)")}>{t("intent.inScope")}</div>
          <List items={intent.in_scope} />
        </div>
        <div>
          <div style={s.colTitle("var(--text-tertiary)")}>{t("intent.outOfScope")}</div>
          <List items={intent.out_of_scope} />
        </div>
      </div>

      {intent.sources.length > 0 && (
        <div>
          <div style={s.sectionTitle}>{t("intent.sources")}</div>
          <div style={s.chips}>
            {intent.sources.map((src, i) => (
              <Badge
                key={`${src.kind}-${src.ref}-${i}`}
                mono
                color={src.resolved ? undefined : "var(--warning, #d29922)"}
              >
                {t(`intent.sourceKind.${src.kind}`)}: {src.ref}
                {!src.resolved && ` (${t("intent.unresolvedTag")})`}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {intent.missing_context.length > 0 && (
        <div style={s.missing}>
          <div style={s.sectionTitle}>{t("intent.missing")}</div>
          <ul style={s.list}>{intent.missing_context.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      {error}
    </section>
  );
}
