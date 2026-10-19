/* Multi-agent results screen (AC-35..52). Owns the results poll (every 2 s
   while any agent is queued/running, so each column's status badge updates as
   the run progresses), the Columns|Tabs toggle, the grouped findings, the
   "Where agents disagree" block, the measured "1 vs N" block, and mounts the
   EXISTING RunTraceDrawer via ?trace=<run_id>. Plain-text model output only; no
   embedded LiveLogStream and no per-agent SSE on this page. */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Skeleton, Tabs } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import RunTraceDrawer from "@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer";
import { useActiveRepo } from "@/lib/repo-context";
import { usePulls } from "@/features/pulls/api/hooks";
import type { AgentColumn } from "@devdigest/shared";
import { useMultiAgentResults } from "../api/hooks";
import { alsoFlaggedByMap, resolveGroups } from "../model/groups";
import { formatCost, formatDuration } from "../model/format";
import { AgentColumnCard } from "./AgentColumnCard";
import { AgentDetail } from "./AgentDetail";
import { ConflictsBlock } from "./ConflictsBlock";
import { FindingGroupCard } from "./FindingGroupCard";
import { OneVsNBlock } from "./OneVsNBlock";

type ViewMode = "columns" | "tabs";

export function MultiAgentResultsScreen({ prId, parentId }: { prId: string | null; parentId: string | null }) {
  const t = useTranslations("multiAgent");
  const search = useSearchParams();
  const router = useRouter();
  const { repoId } = useActiveRepo();

  const { data: run, isLoading, isError } = useMultiAgentResults(prId, parentId, repoId);
  const pulls = usePulls(repoId);

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
  const goConfigure = () => router.push(`/multi-agent?configure=1${prId ? `&pr=${encodeURIComponent(prId)}` : ""}`);

  const columns: AgentColumn[] = React.useMemo(() => run?.columns ?? [], [run]);
  const agentName = React.useCallback(
    (agentId: string) => columns.find((c) => c.agent_id === agentId)?.agent_name ?? agentId,
    [columns],
  );
  const groups = React.useMemo(() => resolveGroups(run?.groups ?? [], columns), [run, columns]);
  const alsoFlagged = React.useMemo(() => alsoFlaggedByMap(groups, agentName), [groups, agentName]);

  const crumb = [{ label: t("results.title") }, ...(run?.pr_number != null ? [{ label: `#${run.pr_number}` }] : [])];

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
        <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 12 }} aria-busy="true">
          <Skeleton height={28} width={280} />
          <Skeleton height={180} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("results.loading")}</span>
        </div>
      </AppShell>
    );
  }
  if (isError || !run) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
          <ErrorState title={t("results.error")} />
          <Button kind="secondary" size="sm" icon="Settings" onClick={goConfigure}>
            {t("results.configureRun")}
          </Button>
        </div>
      </AppShell>
    );
  }

  const activeColumn = columns.find((c) => c.run_id === activeTab) ?? columns[0];
  const traceColumn = columns.find((c) => c.run_id === traceRunId);
  const prNumber = run.pr_number ?? undefined;
  const pr = (pulls.data ?? []).find((p) => p.id === prId);
  const settled = run.comparison.agents_done > 0;
  const allFindingsEmpty = columns.length > 0 && run.status !== "running" && columns.every((c) => c.findings.length === 0);

  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: "24px 32px 44px", display: "flex", flexDirection: "column", gap: 20, maxWidth: 1320, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <Button kind="secondary" size="sm" icon="Settings" onClick={goConfigure}>
              {t("results.configureRun")}
            </Button>
            <h1 style={{ fontSize: 20, margin: 0 }}>{t("results.title")}</h1>
            <span role="status" style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("results.subtitle", { count: run.agent_count, status: t(`results.runStatus.${run.status}`) })}
            </span>
          </div>
          <div style={{ display: "flex", gap: 6 }} role="group" aria-label={t("results.viewToggle")}>
            <Button kind={view === "columns" ? "primary" : "secondary"} size="sm" aria-pressed={view === "columns"} onClick={() => setView("columns")}>
              {t("results.viewColumns")}
            </Button>
            <Button kind={view === "tabs" ? "primary" : "secondary"} size="sm" aria-pressed={view === "tabs"} onClick={() => setView("tabs")}>
              {t("results.viewTabs")}
            </Button>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
          <span>
            <span className="mono" style={{ color: "var(--text-muted)" }}>#{run.pr_number ?? "—"}</span>{" "}
            {pr && repoId ? (
              <Link href={`/repos/${repoId}/pulls/${pr.number}`} style={{ color: "inherit" }}>
                {pr.title}
              </Link>
            ) : null}
          </span>
          {settled && (
            <span style={{ color: "var(--text-muted)" }}>
              {t("results.meta", {
                count: run.agent_count,
                duration: formatDuration(run.total_duration_ms),
                cost: formatCost(run.total_cost_usd),
              })}
            </span>
          )}
        </div>

        {columns.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("results.empty")}</p>
        ) : view === "columns" ? (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(columns.length, 4)}, minmax(240px, 1fr))`, gap: 16, overflowX: "auto", alignItems: "stretch" }}>
            {columns.map((c) => (
              <AgentColumnCard key={c.run_id} column={c} onViewTrace={setTrace} />
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Tabs
              value={activeColumn?.run_id ?? ""}
              onChange={setActiveTab}
              pad="0"
              tabs={columns.map((c) => ({ key: c.run_id, label: c.agent_name, count: c.status === "done" ? (c.score ?? undefined) : undefined }))}
            />
            {activeColumn && (
              <AgentDetail column={activeColumn} prId={prId} alsoFlaggedBy={alsoFlagged} onViewTrace={setTrace} />
            )}
          </div>
        )}

        {allFindingsEmpty && <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>{t("results.noFindingsAtAll")}</p>}

        {view === "columns" && groups.length > 0 && (
          <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 style={{ fontSize: 15, margin: 0 }}>{t("results.groupedHeading", { count: groups.length })}</h2>
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

        <OneVsNBlock comparison={run.comparison} status={run.status} />
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
