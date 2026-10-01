"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { PrDetailHeader } from "@/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader";
import { IntentCard } from "@/app/repos/[repoId]/pulls/[number]/_components/IntentCard";
import { OverviewTab } from "@/app/repos/[repoId]/pulls/[number]/_components/OverviewTab";
import { FindingsTab } from "@/app/repos/[repoId]/pulls/[number]/_components/FindingsTab";
import { DiffTab } from "@/app/repos/[repoId]/pulls/[number]/_components/DiffTab";
import RunTraceDrawer from "@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer";
import { usePullDetail, usePulls } from "@/features/pulls/api/hooks";
import { usePrIntent, useRederiveIntent, usePrReviews, useCancelRun, usePrActiveRuns, usePrRuns, useDeleteRun } from "@/features/reviews/api/hooks";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { githubPrUrl } from "@/lib/github-urls";
import { pullKeys, reviewKeys, runKeys } from "@/shared/api/query-keys";
import { useQueryClient } from "@tanstack/react-query";
import type { FindingRecord } from "@devdigest/shared";
import type { Severity } from "@devdigest/ui";

export function PullDetailScreen({ repoId, number }: { repoId: string; number: string }) {
  const search = useSearchParams(); const router = useRouter(); const t = useTranslations("common");
  const { activeRepo } = useActiveRepo(); const repoNotFound = useRepoNotFound(repoId);
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const prId = pulls?.find((p) => p.number === Number(number))?.id ?? null;
  const { data: pr, isLoading: detailLoading, isError, error, refetch } = usePullDetail(prId);
  const { data: reviews, refetch: refetchReviews } = usePrReviews(prId);
  const { data: intent, isLoading: intentLoading, refetch: refetchIntent } = usePrIntent(prId); const rederive = useRederiveIntent(prId);
  const qc = useQueryClient(); const { data: activeRuns } = usePrActiveRuns(prId); const { data: prRuns } = usePrRuns(prId);
  const deleteRun = useDeleteRun(prId); const cancel = useCancelRun();
  const liveRunIds = (activeRuns ?? []).map((r) => r.run_id); const reviewRunning = liveRunIds.length > 0;
  const invalidateActiveRuns = () => { if (prId) qc.invalidateQueries({ queryKey: runKeys.active(prId) }); };
  const invalidateRunHistory = () => { if (prId) qc.invalidateQueries({ queryKey: runKeys.history(prId) }); };
  const tab = search.get("tab") ?? "overview"; const traceRunId = search.get("trace"); const severityFilter = search.get("severity");
  const setParam = (key: string, val: string | null) => { const sp = new URLSearchParams(search.toString()); if (val == null) sp.delete(key); else sp.set(key, val); router.replace(`/repos/${repoId}/pulls/${number}${sp.toString() ? `?${sp.toString()}` : ""}`); };
  const setTab = (value: string) => setParam("tab", value);
  const allFindings: FindingRecord[] = React.useMemo(() => (reviews ?? []).flatMap((r) => r.findings), [reviews]);
  const lethalTrifecta = allFindings.filter((f) => f.kind === "lethal_trifecta"); const findingsCount = allFindings.length;
  const severityCounts: Partial<Record<Severity, number>> = React.useMemo(() => { const counts: Partial<Record<Severity, number>> = {}; for (const f of allFindings) { const sev = f.severity as Severity; counts[sev] = (counts[sev] ?? 0) + 1; } return counts; }, [allFindings]);
  const repoName = activeRepo?.full_name ?? repoId; const repoFullName = activeRepo?.full_name ?? null;
  const crumb = [{ label: repoName, mono: true, href: `/repos/${repoId}/pulls` }, { label: t("pullDetail.pullRequests"), href: `/repos/${repoId}/pulls` }, { label: `#${number}`, mono: true }];
  if (repoNotFound) return <AppShell crumb={crumb}><RepoNotFound /></AppShell>;
  if (pullsLoading || (prId != null && detailLoading)) return <AppShell crumb={crumb}><div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1080, margin: "0 auto" }}><Skeleton height={28} width={420} /><Skeleton height={16} width={300} /><Skeleton height={200} /></div></AppShell>;
  if (isError || !pr) return <AppShell crumb={crumb}><ErrorState fullScreen title={t("pullDetail.loadErrorTitle")} body={error instanceof ApiError ? error.message : t("pullDetail.loadErrorBody", { number })} onRetry={() => refetch()} /></AppShell>;
  const runs = reviews ?? [];
  return <AppShell crumb={crumb}>
    <PrDetailHeader repoId={repoId} pr={pr} prId={prId} tab={tab} findingsCount={findingsCount} severityCounts={severityCounts} severityFilter={severityFilter} onSelectSeverity={(severity) => { setParam("severity", severityFilter === severity ? null : severity); setTab("findings"); }} githubUrl={repoFullName ? githubPrUrl(repoFullName, pr.number) : null} onSetTab={setTab} onRunStart={() => setTab("findings")} onRunsStarted={invalidateActiveRuns} />
    <div style={{ padding: "24px 32px 44px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 1080, margin: "0 auto" }}>
      {(tab === "overview" || tab === "findings") && <IntentCard intent={intent} loading={intentLoading} onRederive={() => rederive.mutate()} rederiving={rederive.isPending} errorMessage={rederive.isError ? (rederive.error instanceof Error ? rederive.error.message : String(rederive.error)) : null} />}
      {tab === "overview" && <OverviewTab prBody={pr.body} />}
  {tab === "findings" && <FindingsTab prId={prId} liveRunIds={liveRunIds} reviewRunning={reviewRunning} lethalTrifecta={lethalTrifecta} runs={runs} prRuns={prRuns} prCommits={pr.commits} repoFullName={repoFullName} headSha={pr.head_sha} cancelMutation={cancel} severityFilter={severityFilter} onOpenTrace={(id) => setParam("trace", id)} onDelete={(id) => { if (window.confirm(t("pullDetail.deleteRunConfirm"))) deleteRun.mutate(id); }} onRunDone={() => { invalidateActiveRuns(); invalidateRunHistory(); if (prId) qc.invalidateQueries({ queryKey: reviewKeys.byPull(prId) }); refetchReviews(); refetchIntent(); }} />}
      {tab === "diff" && <DiffTab prId={prId} filesCount={pr.files_count} files={pr.files} canComment={pr.status === "open"} />}
    </div>
    {prId && traceRunId && <RunTraceDrawer runId={traceRunId} prNumber={pr.number} findings={runs.find((r) => r.run_id === traceRunId)?.findings ?? []} agentName={runs.find((r) => r.run_id === traceRunId)?.agent_name ?? null} onClose={() => setParam("trace", null)} />}
  </AppShell>;
}
