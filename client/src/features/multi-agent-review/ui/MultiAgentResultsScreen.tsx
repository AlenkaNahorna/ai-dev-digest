/* Multi-agent results screen (AC-35..52). Owns the results poll, the
   Columns|Tabs view toggle, the conflicts block + "Show only conflicts", and
   mounts the EXISTING RunTraceDrawer via ?trace=<run_id>. Plain-text model
   output only; no embedded LiveLogStream and no per-agent SSE on this page. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Tabs } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import RunTraceDrawer from "@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer";
import type { AgentColumn } from "@devdigest/shared";
import { useMultiAgentResults } from "../api/hooks";
import { resolveGroups } from "../model/groups";
import { AgentColumnCard } from "./AgentColumnCard";
import { ConflictsBlock } from "./ConflictsBlock";
import { FindingGroupCard } from "./FindingGroupCard";

type ViewMode = "columns" | "tabs";

export function MultiAgentResultsScreen({ prId, parentId }: { prId: string | null; parentId: string | null }) {
  const t = useTranslations("multiAgent");
  const search = useSearchParams();
  const router = useRouter();

  const { data: run, isLoading, isError } = useMultiAgentResults(prId, parentId);

  const [view, setView] = React.useState<ViewMode>("columns");
  const [showOnlyConflicts, setShowOnlyConflicts] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<string | null>(null);

  const traceRunId = search.get("trace");
  const setTrace = (runId: string | null) => {
    const sp = new URLSearchParams(search.toString());
    if (runId == null) sp.delete("trace");
    else sp.set("trace", runId);
    router.replace(`/multi-agent${sp.toString() ? `?${sp.toString()}` : ""}`);
  };

  const columns: AgentColumn[] = React.useMemo(() => run?.columns ?? [], [run]);
  const agentName = React.useCallback(
    (agentId: string) => columns.find((c) => c.agent_id === agentId)?.agent_name ?? agentId,
    [columns],
  );
  const groups = React.useMemo(() => resolveGroups(run?.groups ?? [], columns), [run, columns]);

  const crumb = [{ label: t("results.title") }];

  if (!prId || !parentId) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: 24 }}>
          <ErrorState title={t("results.error")} />
        </div>
      </AppShell>
    );
  }
  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: 24 }}>{t("results.loading")}</div>
      </AppShell>
    );
  }
  if (isError || !run) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: 24 }}>
          <ErrorState title={t("results.error")} />
        </div>
      </AppShell>
    );
  }

  const activeColumn = columns.find((c) => c.run_id === activeTab) ?? columns[0];
  const traceColumn = columns.find((c) => c.run_id === traceRunId);
  const prNumber = run.pr_number ?? undefined;

  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: "24px 32px 44px", display: "flex", flexDirection: "column", gap: 20, maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <h1 style={{ fontSize: 20, margin: 0 }}>{t("results.title")}</h1>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t(`results.runStatus.${run.status}`)}</span>
          </div>
          <div style={{ display: "flex", gap: 6 }} role="group" aria-label={t("results.title")}>
            <Button kind={view === "columns" ? "primary" : "secondary"} size="sm" aria-pressed={view === "columns"} onClick={() => setView("columns")}>
              {t("results.viewColumns")}
            </Button>
            <Button kind={view === "tabs" ? "primary" : "secondary"} size="sm" aria-pressed={view === "tabs"} onClick={() => setView("tabs")}>
              {t("results.viewTabs")}
            </Button>
          </div>
        </div>

        {columns.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("results.empty")}</p>
        ) : view === "columns" ? (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(columns.length, 3)}, minmax(300px, 1fr))`, gap: 16, overflowX: "auto" }}>
            {columns.map((c) => (
              <AgentColumnCard key={c.run_id} column={c} prId={prId} onViewTrace={setTrace} />
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Tabs
              value={activeColumn?.run_id ?? ""}
              onChange={setActiveTab}
              pad="0"
              tabs={columns.map((c) => ({ key: c.run_id, label: c.agent_name, count: c.findings.length || undefined }))}
            />
            {activeColumn && <AgentColumnCard column={activeColumn} prId={prId} onViewTrace={setTrace} />}
          </div>
        )}

        {!showOnlyConflicts && groups.length > 0 && (
          <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 style={{ fontSize: 15, margin: 0 }}>{t("results.findingsCount", { count: groups.length })}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {groups.map((g) => (
                <FindingGroupCard key={g.key} group={g} agentName={agentName} prId={prId} />
              ))}
            </div>
          </section>
        )}

        <ConflictsBlock
          conflicts={run.conflicts}
          showOnlyConflicts={showOnlyConflicts}
          onToggleShowOnly={setShowOnlyConflicts}
          runIdForAgent={(agentId) => columns.find((c) => c.agent_id === agentId)?.run_id}
          onViewTrace={setTrace}
        />
      </div>

      {traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          agentName={traceColumn?.agent_name ?? null}
          prNumber={prNumber}
          running={traceColumn?.status === "running"}
          onClose={() => setTrace(null)}
        />
      )}
    </AppShell>
  );
}
