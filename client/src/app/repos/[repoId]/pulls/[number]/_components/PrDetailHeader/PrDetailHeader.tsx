"use client";

import React, { useCallback } from "react";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, Button, Tabs, SeverityBadge, type Severity } from "@devdigest/ui";
import { RunReviewDropdown } from "../RunReviewDropdown";
import { s } from "./styles";
import type { PrDetail } from "@/lib/types";

/** Severities shown in the counter bar, in display order. */
const SEVERITY_ORDER: Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

interface PrDetailHeaderProps {
  repoId: string;
  pr: PrDetail;
  prId: string | null;
  tab: string;
  findingsCount: number;
  /** Non-zero severities only — e.g. {CRITICAL: 3, WARNING: 5}. */
  severityCounts: Partial<Record<Severity, number>>;
  severityFilter?: string | null;
  onSelectSeverity: (severity: Severity) => void;
  /** github.com PR URL; null when the repo's full_name isn't known yet. */
  githubUrl?: string | null;
  onSetTab: (tab: string) => void;
  onRunStart: () => void;
  onRunsStarted: () => void;
}

export function PrDetailHeader({
  repoId,
  pr,
  prId,
  tab,
  findingsCount,
  severityCounts,
  severityFilter,
  onSelectSeverity,
  githubUrl,
  onSetTab,
  onRunStart,
  onRunsStarted,
}: PrDetailHeaderProps) {
  const t = useTranslations("prReview");
  const handleRunStart = useCallback(() => {
    onRunStart();
  }, [onRunStart]);

  const handleRunsStarted = useCallback(() => {
    onRunsStarted();
  }, [onRunsStarted]);

  const statusColor =
    pr.status === "merged"
      ? "var(--ok)"
      : pr.status === "closed"
        ? "var(--stale)"
        : "var(--warn)";

  return (
    <div style={s.root}>
      <div style={s.titleRow}>
        <div style={s.titleCol}>
          <h1 style={s.h1}>
            <span className="mono" style={s.prNumber}>
              #{pr.number}
            </span>
            {pr.title}
          </h1>
          <div style={s.meta}>
            <span style={s.authorChip}>
              <Avatar name={pr.author} size={17} />
              {pr.author}
            </span>
            <span style={s.branchChip}>
              <Icon.GitBranch size={13} style={{ color: "var(--text-muted)" }} />
              <span className="mono" style={s.branchMono}>
                {pr.branch}
              </span>
              <Icon.ArrowRight size={11} />
              <span className="mono" style={s.branchMono}>
                {pr.base}
              </span>
            </span>
            <span className="mono tnum">
              <span style={{ color: "var(--code-add-text)" }}>+{pr.additions}</span>{" "}
              <span style={{ color: "var(--code-del-text)" }}>−{pr.deletions}</span>
            </span>
            <Badge dot bg="transparent" color={statusColor}>
              {pr.status}
            </Badge>
          </div>
        </div>
        <div style={s.actions}>
          <Button
            kind="ghost"
            size="sm"
            icon="ExternalLink"
            disabled={!githubUrl}
            onClick={() =>
              githubUrl && window.open(githubUrl, "_blank", "noopener,noreferrer")
            }
          >{t("detail.viewOnGithub")}</Button>
          {prId && (
            <RunReviewDropdown
              prId={prId}
              repoId={repoId}
              warnMerged={pr.status === "merged" || pr.status === "closed"}
              onRunStart={handleRunStart}
              onRunsStarted={handleRunsStarted}
            />
          )}
        </div>
      </div>
      {(pr.status === "merged" || pr.status === "closed") && (
        <div style={s.staleBanner}>
          <Icon.AlertTriangle size={13} style={{ color: "var(--warn)", flexShrink: 0 }} />
          <span>
            {t("detail.closedWarning", { status: pr.status })}
          </span>
        </div>
      )}
      {SEVERITY_ORDER.some((sev) => severityCounts[sev]) && (
        <div style={s.severityBar}>
          {SEVERITY_ORDER.filter((sev) => severityCounts[sev]).map((sev) => (
            <button
              key={sev}
              type="button"
              onClick={() => onSelectSeverity(sev)}
              style={s.severityButton(severityFilter === sev)}
              aria-pressed={severityFilter === sev}
            >
              <SeverityBadge severity={sev} count={severityCounts[sev]} />
            </button>
          ))}
        </div>
      )}
      <Tabs
        value={tab}
        onChange={onSetTab}
        pad="0"
        tabs={[
          { key: "overview", label: t("detail.tabs.overview"), icon: "FileText" },
          { key: "findings", label: t("detail.tabs.findings"), icon: "AlertOctagon", count: findingsCount || undefined },
          { key: "diff", label: t("detail.tabs.diff"), icon: "Code", count: pr.files_count },
        ]}
      />
    </div>
  );
}
