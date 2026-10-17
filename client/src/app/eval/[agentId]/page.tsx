/* /eval/:agentId — one agent's eval trend, run history and compare. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card } from "@devdigest/ui";
import { AppShell } from "../../../components/app-shell";
import { notify } from "../../../lib/toast";
import { useAgent } from "../../../lib/hooks/agents";
import { useEvalBatches, useEvalCases, useRunEvals } from "../../../features/evals/api/hooks";
import { MetricTiles } from "../../../features/evals/ui/MetricTiles";
import { RunsTable } from "../../../features/evals/ui/RunsTable";
import { TrendChart } from "../../../features/evals/ui/TrendChart";

export default function AgentEvalPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const t = useTranslations("eval");
  const { data: agent } = useAgent(agentId);
  const batches = useEvalBatches(agentId);
  const cases = useEvalCases(agentId);
  const run = useRunEvals(agentId);
  const list = batches.data?.batches ?? [];
  const crumb = [
    { label: "Skills Lab" },
    { label: t("dashboard.defaultTitle"), href: "/eval" },
    { label: agent?.name ?? "Agent" },
  ];
  const total = cases.data?.cases.length ?? 0;
  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ fontSize: 20, margin: 0, flex: 1 }}>{agent?.name ?? t("dashboard.defaultTitle")}</h1>
          <Button
            kind="primary"
            icon="Play"
            loading={run.isPending}
            disabled={total === 0 || run.isPending}
            onClick={() =>
              run.mutate(undefined, {
                onSuccess: (d) => notify.success(t("pipeline.tab.runDone", { passed: d.summary.cases_passed, total: d.summary.cases_total })),
                onError: () => notify.error(t("pipeline.tab.runFailed")),
              })
            }
          >
            {t("dashboard.runEval", { count: total })}
          </Button>
        </div>
        <MetricTiles batches={list} />
        {list.length > 1 && (
          <Card>
            <TrendChart batches={list} />
          </Card>
        )}
        <section>
          <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>{t("pipeline.history.heading")}</h3>
          <RunsTable batches={list} />
        </section>
      </div>
    </AppShell>
  );
}
