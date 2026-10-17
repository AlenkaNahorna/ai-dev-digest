/* /eval — Eval Dashboard: every agent's latest eval run, trend and the most recent runs. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, EmptyState, ErrorState, Sparkline } from "@devdigest/ui";
import { AppShell } from "../../components/app-shell";
import { useEvalOverview } from "../../features/evals/api/hooks";
import { RunsTable } from "../../features/evals/ui/RunsTable";
import { pct, shortTime, versionLabel } from "../../features/evals/lib/format";

export default function EvalDashboardPage() {
  const t = useTranslations("eval");
  const { data, isLoading, isError } = useEvalOverview();
  const crumb = [{ label: "Skills Lab" }, { label: t("dashboard.defaultTitle") }];
  const th: React.CSSProperties = { textAlign: "left", fontSize: 11, color: "var(--text-muted)", padding: "8px 10px" };
  const td: React.CSSProperties = { padding: "8px 10px", fontSize: 13 };

  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>{t("dashboard.defaultTitle")}</h1>
        {isLoading ? (
          <div>{t("dashboard.loading")}</div>
        ) : isError || !data ? (
          <ErrorState title={t("pipeline.history.error")} />
        ) : data.agents.length === 0 ? (
          <EmptyState icon="Gauge" title={t("dashboard.defaultTitle")} body={t("dashboard.noRuns")} />
        ) : (
          <>
            <Card>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Agent", "recall", "precision", "citation", "pass", "trend"].map((k) => (
                      <th key={k} style={th}>
                        {k === "Agent" ? k : k === "trend" ? t("dashboard.metricTrend") : t(`dashboard.table.${k}`)}
                      </th>
                    ))}
                    <th style={th}>{t("dashboard.table.ranAt")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((a) => (
                    <tr key={a.agent_id} data-testid="eval-agent-row" style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={td}>
                        <Link href={`/eval/${a.agent_id}`} style={{ color: "var(--accent)" }}>
                          {a.agent_name}
                        </Link>{" "}
                        <span style={{ color: "var(--text-muted)" }}>
                          {a.provider}/{a.model} · {versionLabel(a.latest?.agent_version)}
                        </span>
                      </td>
                      <td style={td}>{pct(a.latest?.recall)}</td>
                      <td style={td}>{pct(a.latest?.precision)}</td>
                      <td style={td}>{pct(a.latest?.citation_accuracy)}</td>
                      <td style={td}>{a.latest ? `${a.latest.cases_passed}/${a.latest.cases_total}` : `—/${a.cases_total}`}</td>
                      <td style={td}>
                        <Sparkline
                          data={[...a.trend].reverse().map((p) => p.recall).filter((v): v is number => v !== null)}
                          w={90}
                          h={22}
                        />
                      </td>
                      <td style={{ ...td, color: "var(--text-muted)" }}>{a.latest ? shortTime(a.latest.ran_at) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <section>
              <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>{t("dashboard.recentRuns")}</h3>
              <RunsTable batches={data.recent} />
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
