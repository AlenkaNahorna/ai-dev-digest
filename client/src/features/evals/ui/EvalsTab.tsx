"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Card } from "@devdigest/ui";
import type { EvalCaseDraft, EvalCaseRecord } from "@devdigest/shared";
import { notify } from "@/lib/toast";
import {
  useDeleteEvalCase,
  useEvalBatches,
  useEvalCases,
  useImportEvalCases,
  useRunEvalCase,
  useRunEvals,
} from "../api/hooks";
import { EvalCasesList } from "./EvalCasesList";
import { NewEvalCaseModal } from "./NewEvalCaseModal";
import { MetricTiles } from "./MetricTiles";
import { RunsTable } from "./RunsTable";
import { TrendChart } from "./TrendChart";

/** Evals tab of the agent editor: run all, metrics, cases, history, compare (AC-30..AC-36). */
export function EvalsTab({
  agentId,
  agent,
}: {
  agentId: string;
  /** Shown in the edit modal's "PR meta" tab. */
  agent?: { name: string; provider: string; model: string };
}) {
  const t = useTranslations("eval");
  const cases = useEvalCases(agentId);
  const batches = useEvalBatches(agentId);
  const run = useRunEvals(agentId);
  const importer = useImportEvalCases(agentId);
  const del = useDeleteEvalCase();
  const runCase = useRunEvalCase();
  const [editing, setEditing] = React.useState<{ caseId: string; draft: EvalCaseDraft } | null>(null);
  const edit = (c: EvalCaseRecord) =>
    setEditing({
      caseId: c.id,
      draft: {
        agent_id: c.agent_id,
        agent_name: agent?.name ?? "",
        provider: agent?.provider ?? "",
        model: agent?.model ?? "",
        name: c.name,
        expectation: c.expectation,
        input_diff: c.input_diff,
        source_finding_id: c.source_finding_id ?? "",
        source_pr_id: c.source_pr_id ?? "",
      },
    });
  const list = batches.data?.batches ?? [];
  const total = cases.data?.cases.length ?? 0;

  const onRun = () =>
    run.mutate(undefined, {
      onSuccess: (d) =>
        notify.success(t("pipeline.tab.runDone", { passed: d.summary.cases_passed, total: d.summary.cases_total })),
      onError: () => notify.error(t("pipeline.tab.runFailed")),
    });
  const onImport = () =>
    importer.mutate(undefined, {
      onSuccess: (r) =>
        notify.success(
          t("pipeline.tab.importResult", { created: r.created, skipped: r.skipped, failed: r.failed }),
        ),
      onError: () => notify.error(t("pipeline.tab.runFailed")),
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Button kind="primary" icon="Play" loading={run.isPending} disabled={total === 0 || run.isPending} onClick={onRun}>
          {run.isPending ? t("pipeline.tab.running") : t("pipeline.tab.runAll")}
        </Button>
        <Button kind="secondary" icon="RefreshCw" loading={importer.isPending} onClick={onImport}>
          {t("pipeline.tab.import")}
        </Button>
        <span style={{ flex: 1 }} />
        <Link href={`/eval/${agentId}`} style={{ fontSize: 13, color: "var(--accent)" }}>
          {t("pipeline.tab.dashboardLink")}
        </Link>
      </div>

      <section>
        <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>{t("pipeline.tab.metricsTitle")}</h3>
        <MetricTiles batches={list} />
        {list.length > 1 && (
          <Card style={{ marginTop: 12 }}>
            <TrendChart batches={list} />
          </Card>
        )}
      </section>

      <section>
        <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>
          {t("pipeline.cases.heading")}
          {cases.data && (
            <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: 8 }}>
              {t("pipeline.cases.passing", { passing: cases.data.passing, total })}
            </span>
          )}
        </h3>
        {cases.isLoading ? (
          <div>{t("pipeline.cases.loading")}</div>
        ) : cases.isError || !cases.data ? (
          <div role="alert">{t("pipeline.cases.error")}</div>
        ) : (
          <EvalCasesList
            list={cases.data}
            deleting={del.isPending}
            runningId={runCase.isPending ? runCase.variables : null}
            onRun={(id) => runCase.mutate(id, { onError: () => notify.error(t("pipeline.cases.runFailed")) })}
            onEdit={edit}
            onDelete={(id) => del.mutate(id)}
          />
        )}
      </section>

      <section>
        <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>{t("pipeline.history.heading")}</h3>
        {batches.isLoading ? (
          <div>{t("pipeline.history.loading")}</div>
        ) : batches.isError ? (
          <div role="alert">{t("pipeline.history.error")}</div>
        ) : (
          <RunsTable batches={list} />
        )}
      </section>
      {editing && (
        <NewEvalCaseModal key={editing.caseId} caseId={editing.caseId} draft={editing.draft} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
