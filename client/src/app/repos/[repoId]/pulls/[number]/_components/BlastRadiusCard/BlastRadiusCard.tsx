"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { BlastRadius } from "@devdigest/shared";
import { BlastGraph } from "./BlastGraph";
import { BlastSymbolRow } from "./BlastSymbolRow";
import { IndexNotice } from "./IndexNotice";
import { blastCounts, callersForSymbol, isIndexIncomplete, symbolEntries, type BlastIndexInfo } from "./helpers";
import { s } from "./styles";

export interface BlastRadiusCardProps {
  /** undefined while loading or after an error. */
  data: BlastRadius | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  repoFullName: string | null;
  /** PR head sha; pins caller links to the PR's head. */
  headSha: string;
  /** Repo index state and resync action; anything but a "full" index shows the "incomplete" mark. */
  index?: BlastIndexInfo;
}

/**
 * "What else can this PR touch": counts, a collapsible tree (or graph) of changed symbol ->
 * callers (GitHub links) and endpoint/cron chips. Pure read of GET /pulls/:id/blast, so no
 * model call is involved. Degraded or partial data is shown together with a notice.
 */
export function BlastRadiusCard({ data, isLoading, isError, onRetry, repoFullName, headSha, index }: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const [view, setView] = React.useState<"tree" | "graph">("tree");
  if (isLoading) return <Skeleton height={140} />;
  if (isError || !data) return <ErrorState title={t("error.title")} body={t("error.body")} onRetry={onRetry} />;

  const counts = blastCounts(data);
  const stats = [
    { key: "symbols", icon: Icon.Code, value: counts.symbols, label: t("stat.symbols") },
    { key: "callers", icon: Icon.CornerDownRight, value: counts.callers, label: t("stat.callers") },
    { key: "endpoints", icon: Icon.Globe, value: counts.endpoints, label: t("stat.endpoints") },
    { key: "crons", icon: Icon.Clock, value: counts.crons, label: t("stat.crons") },
  ];
  const entries = symbolEntries(data);
  const firstOpen = entries.find((e) => (callersForSymbol(data, e.symbol.name)?.callers.length ?? 0) > 0);

  return (
    <section style={s.wrap} aria-label={t("title")}>
      <span style={s.sectionTitle}>{t("title")}</span>
      <div style={s.statsRow}>
        <div style={s.stats}>
          {stats.map((st) => (
            <div key={st.key} style={s.stat}>
              <st.icon size={13} aria-hidden="true" />
              <span style={s.statValue}>{st.value}</span>
              <span style={s.statLabel}>{st.label}</span>
            </div>
          ))}
        </div>
        {data.changed_symbols.length > 0 && (
          <div style={s.toggleGroup} role="group" aria-label={t("view.label")}>
            {(["tree", "graph"] as const).map((v) => (
              <button key={v} type="button" style={s.toggleBtn(view === v)} aria-pressed={view === v} onClick={() => setView(v)}>
                {t(`view.${v}`)}
              </button>
            ))}
          </div>
        )}
      </div>
      {isIndexIncomplete(data, index?.status) && <IndexNotice data={data} index={index} />}
      {data.changed_symbols.length === 0 ? (
        !data.degraded && <div style={s.muted}>{t("noSymbols")}</div>
      ) : (
        <>
          {data.downstream.length === 0 && <div style={s.muted}>{t("noDownstream", { count: data.changed_symbols.length })}</div>}
          {view === "graph" ? (
            <BlastGraph data={data} repoFullName={repoFullName} headSha={headSha} />
          ) : (
            <ul style={s.list}>
              {entries.map((entry) => (
                <BlastSymbolRow
                  key={entry.symbol.name}
                  symbol={entry.symbol}
                  extraFiles={entry.extraFiles}
                  impact={callersForSymbol(data, entry.symbol.name)}
                  defaultOpen={entry === firstOpen}
                  repoFullName={repoFullName}
                  headSha={headSha}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
