/* "Configure run" screen (AC-7..AC-10, AC-13/14). Pick a pull request, then the
   agents to fan out. Until a PR is chosen the agents area is a placeholder and
   the run button is disabled (the design shows it enabled — AC-8 guards it).
   Per agent: a one-line summary of its latest verdict on THIS PR (or an explicit
   "no prior run") and its pre-run estimate (or "no estimate", never a made-up
   number). All model-derived text (summaries) is rendered as plain text. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, EmptyState, Icon, SearchableSelect, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { ApiError } from "@/lib/api";
import { useActiveRepo } from "@/lib/repo-context";
import { useAgents } from "@/lib/hooks/agents";
import { usePulls } from "@/features/pulls/api/hooks";
import { usePrReviews } from "@/features/reviews/api/hooks";
import { useMultiAgentEstimate, useStartMultiAgentRun } from "../api/hooks";
import { summarizeEstimates } from "../model/estimate";
import { formatCost, formatDuration } from "../model/format";
import { latestReviewByAgent, oneLine } from "../model/prior-verdict";
import { EstimateFooter } from "./EstimateFooter";

export function ConfigureRunScreen({ initialPrId }: { initialPrId?: string | null }) {
  const t = useTranslations("multiAgent");
  const router = useRouter();
  const { repoId, reposLoaded } = useActiveRepo();

  const pulls = usePulls(repoId);
  const agentsQuery = useAgents();
  const agents = React.useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);

  const [prId, setPrId] = React.useState<string | null>(initialPrId ?? null);
  // `null` = not initialised for the current PR yet; then owned by the user.
  const [selected, setSelected] = React.useState<Set<string> | null>(null);

  const start = useStartMultiAgentRun(prId);
  const reviews = usePrReviews(prId);
  const allIds = React.useMemo(() => agents.map((a) => a.id), [agents]);
  const estimateQuery = useMultiAgentEstimate(prId, allIds);
  const estimateByAgent = React.useMemo(
    () => new Map((estimateQuery.data?.estimates ?? []).map((e) => [e.agent_id, e])),
    [estimateQuery.data],
  );
  const priorByAgent = React.useMemo(() => latestReviewByAgent(reviews.data ?? []), [reviews.data]);

  // Preselect the enabled agents once the list is there; reset when the PR changes.
  React.useEffect(() => {
    if (prId && selected == null && agents.length) {
      setSelected(new Set(agents.filter((a) => a.enabled).map((a) => a.id)));
    }
  }, [prId, selected, agents]);

  const selectedIds = React.useMemo(() => [...(selected ?? [])].filter((id) => allIds.includes(id)), [selected, allIds]);
  const summary = React.useMemo(
    () => summarizeEstimates(selectedIds.map((id) => estimateByAgent.get(id)).filter((e) => e != null)),
    [selectedIds, estimateByAgent],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAll = () => setSelected(new Set(agents.filter((a) => a.enabled).map((a) => a.id)));
  const choosePr = (id: string) => {
    setPrId(id || null);
    setSelected(null);
    start.reset();
  };

  const canRun = !!prId && selectedIds.length > 0 && !start.isPending;
  const onRun = async () => {
    if (!canRun || !prId) return;
    try {
      const res = await start.mutateAsync(selectedIds);
      router.push(`/multi-agent?pr=${encodeURIComponent(prId)}&run=${encodeURIComponent(res.parent_id)}`);
    } catch {
      /* surfaced below through start.error */
    }
  };

  const startError =
    start.error instanceof ApiError && start.error.code === "multi_agent_run_active"
      ? t("picker.activeError")
      : start.isError
        ? t("picker.startError")
        : null;

  const crumb = [{ label: t("results.title") }, { label: t("configure.crumb") }];
  const prOptions = (pulls.data ?? [])
    .filter((p): p is typeof p & { id: string } => !!p.id)
    .map((p) => ({ value: p.id, label: `#${p.number} · ${p.title}` }));
  const runLabel = t("configure.runButton", { count: selectedIds.length });

  return (
    <AppShell crumb={crumb}>
      <div style={{ maxWidth: 740, margin: "0 auto", padding: "32px 24px 56px", display: "flex", flexDirection: "column", gap: 22 }}>
        <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1 style={{ fontSize: 24, margin: 0, letterSpacing: "-0.02em" }}>{t("configure.title")}</h1>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary)" }}>{t("configure.subtitle")}</p>
        </header>

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <StepHeading n={1} label={t("configure.stepPr")} />
          <div style={{ marginLeft: 36, maxWidth: 440 }}>
            {pulls.isLoading || !reposLoaded ? (
              <Skeleton height={34} />
            ) : !repoId ? (
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>{t("configure.noRepo")}</p>
            ) : (
              <SearchableSelect
                value={prId ?? ""}
                onChange={choosePr}
                options={prOptions}
                placeholder={t("configure.selectPr")}
                mono={false}
              />
            )}
          </div>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <StepHeading n={2} label={t("configure.stepAgents")} muted={!prId} />
            {prId && agents.length > 0 && (
              <button
                type="button"
                onClick={selectAll}
                style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 12.5 }}
              >
                {t("configure.selectAll")}
              </button>
            )}
          </div>

          <div style={{ marginLeft: 36 }}>
            {!prId ? (
              <div
                style={{
                  border: "1px dashed var(--border-strong)",
                  borderRadius: 10,
                  background: "var(--bg-elevated)",
                }}
              >
                <EmptyState icon="GitPullRequest" title={t("configure.pickFirstTitle")} body={t("configure.pickFirstBody")} />
              </div>
            ) : agentsQuery.isLoading ? (
              <Skeleton height={120} />
            ) : agents.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>{t("picker.noAgents")}</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {agents.map((a) => {
                  const checked = selected?.has(a.id) ?? false;
                  const prior = priorByAgent.get(a.id);
                  const est = estimateByAgent.get(a.id);
                  const hasEst = est != null && est.sample_size > 0;
                  return (
                    <li
                      key={a.id}
                      title={a.enabled ? undefined : t("picker.notSelectable")}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "12px 14px",
                        border: `1px solid ${checked ? "var(--accent)" : "var(--border)"}`,
                        borderRadius: 10,
                        background: "var(--bg-elevated)",
                        opacity: a.enabled ? 1 : 0.55,
                      }}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={!a.enabled}
                        ariaLabel={a.name}
                        onChange={() => a.enabled && toggle(a.id)}
                      />
                      <span
                        aria-hidden
                        style={{ width: 32, height: 32, borderRadius: 8, background: "var(--bg-hover)", display: "grid", placeItems: "center", flexShrink: 0 }}
                      >
                        <Icon.Cpu size={16} />
                      </span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                        <strong style={{ fontSize: 14 }}>
                          {a.name}
                          {!a.enabled && (
                            <span style={{ fontWeight: 400, color: "var(--text-muted)", fontSize: 11.5 }}> · {t("picker.disabledSuffix")}</span>
                          )}
                        </strong>
                        {/* Plain text: the summary is model output. */}
                        <span style={{ fontSize: 12.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {reviews.isLoading
                            ? "…"
                            : prior?.summary
                              ? oneLine(prior.summary)
                              : t("configure.noPriorRun")}
                        </span>
                      </div>
                      <span className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                        {hasEst
                          ? `${formatDuration(est.mean_duration_ms)} · ${formatCost(est.mean_cost_usd)}`
                          : t("configure.noEstimate")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <div style={{ marginLeft: 36, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <Button kind="primary" icon="Users" disabled={!canRun} loading={start.isPending} onClick={onRun}>
              {runLabel}
            </Button>
            {prId && selectedIds.length > 0 && <EstimateFooter summary={summary} loading={estimateQuery.isFetching} />}
          </div>
          {startError && (
            <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--danger, #e5484d)" }}>
              {startError}
            </p>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function StepHeading({ n, label, muted = false }: { n: number; label: string; muted?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, opacity: muted ? 0.6 : 1 }}>
      <span
        aria-hidden
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          fontSize: 12,
          fontWeight: 700,
          background: muted ? "var(--bg-hover)" : "var(--accent-bg)",
          color: muted ? "var(--text-muted)" : "var(--accent)",
        }}
      >
        {n}
      </span>
      <h2 style={{ fontSize: 15, margin: 0 }}>{label}</h2>
    </div>
  );
}
