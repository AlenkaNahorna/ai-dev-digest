/* PRRow — one clickable row in the PR list table. Ported from screen_dashboard.jsx. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, CircularScore, SeverityBadge, type Severity } from "@devdigest/ui";
import type { PrMeta } from "@/lib/types";
import { FindingsPopover } from "../FindingsPopover";
import { formatCost } from "@/lib/format-cost";
import { SIZE_COLOR, STATUS_META } from "../../constants";
import { relativeTime, sizeOf } from "../../helpers";
import { s } from "../../styles";

export function PRRow({
  pr,
  repoId,
}: {
  pr: PrMeta;
  repoId: string;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const [h, setH] = React.useState(false);
  const [findingsHover, setFindingsHover] = React.useState(false);
  const st = STATUS_META[pr.status] ?? STATUS_META.needs_review!;
  const { size, lines } = sizeOf(pr);
  const reviewed = pr.score != null; // null score ⇒ PR has never been reviewed
  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={() => router.push(`/repos/${repoId}/pulls/${pr.number}`)}
      style={s.row(h)}
    >
      <div style={s.rowTitleCell}>
        <Icon.GitPullRequest size={15} style={s.rowIcon(st.c)} />
        <div style={s.rowTitleWrap}>
          <div style={s.rowTitle(h)}>{pr.title}</div>
          <span className="mono" style={s.rowNumber}>
            #{pr.number}
          </span>
        </div>
      </div>
      <div style={s.authorCell}>
        <Avatar name={pr.author} size={18} />
        {pr.author}
      </div>
      <div>
        <Badge
          color={SIZE_COLOR[size]}
          bg="transparent"
          style={s.sizeBadgeBorder(SIZE_COLOR[size]!)}
        >
          {size} · {lines}
        </Badge>
      </div>
      <div style={s.scoreCell}>
        {reviewed ? (
          <CircularScore score={pr.score!} size={34} stroke={3} />
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>
      <div
        style={s.findingsCell}
        tabIndex={pr.findings ? 0 : undefined}
        onMouseEnter={() => pr.findings && setFindingsHover(true)}
        onMouseLeave={() => setFindingsHover(false)}
        onFocus={() => pr.findings && setFindingsHover(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFindingsHover(false);
        }}
        onClick={(e) => pr.findings && e.stopPropagation()}
      >
        {pr.findings ? (
          ([
            ["CRITICAL", pr.findings.critical],
            ["WARNING", pr.findings.warning],
            ["SUGGESTION", pr.findings.suggestion],
          ] as const).map(([severity, count]) =>
            count > 0 ? (
              <SeverityBadge key={severity} severity={severity as Severity} count={count} compact />
            ) : null,
          )
        ) : (
          <span style={s.muted}>—</span>
        )}
        {findingsHover && pr.findings && <FindingsPopover pr={pr} />}
      </div>
      <div>
        <Badge dot color={st.c} bg="transparent">
          {t(`list.status.${st.labelKey}`)}
        </Badge>
      </div>
      <div className="tnum" style={s.costCell}>{formatCost(pr.cost_usd)}</div>
      <div style={s.updatedCell}>{relativeTime(pr.updated_at)}</div>
    </div>
  );
}
