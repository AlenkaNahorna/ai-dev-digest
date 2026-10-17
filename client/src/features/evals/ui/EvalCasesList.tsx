"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, Icon, IconBtn } from "@devdigest/ui";
import type { EvalCaseList, EvalCaseRecord } from "@devdigest/shared";

const KIND_STYLE = {
  must_find: { color: "var(--accent)", bg: "var(--accent-bg, var(--bg-hover))" },
  must_not_flag: { color: "var(--ok)", bg: "var(--ok-bg, var(--bg-hover))" },
} as const;

function where(c: EvalCaseRecord): string {
  const e = c.expectation;
  return `${e.file}:${e.start_line === e.end_line ? e.start_line : `${e.start_line}-${e.end_line}`}`;
}

/** The agent's cases: kind label, name, location, latest result and the row actions (AC-10, AC-11). */
export function EvalCasesList({
  list,
  onRun,
  onEdit,
  onDelete,
  runningId,
  deleting,
}: {
  list: EvalCaseList;
  onRun?: (caseId: string) => void;
  onEdit?: (c: EvalCaseRecord) => void;
  onDelete?: (caseId: string) => void;
  /** The case whose single run is in flight. */
  runningId?: string | null;
  deleting?: boolean;
}) {
  const t = useTranslations("eval");
  if (list.cases.length === 0) {
    return <EmptyState icon="FlaskConical" title={t("pipeline.cases.heading")} body={t("pipeline.cases.empty")} />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {list.cases.map((c) => {
        const e = c.expectation;
        const status = c.latest === null ? "never" : c.latest.pass ? "pass" : "fail";
        const s = c.latest?.summary;
        const running = runningId === c.id;
        return (
          <div
            key={c.id}
            data-testid="eval-case"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
          >
            <span aria-label={status} style={{ width: 18, display: "inline-flex" }}>
              {status === "pass" ? (
                <Icon.CheckCircle size={16} style={{ color: "var(--ok)" }} />
              ) : status === "fail" ? (
                <Icon.XCircle size={16} style={{ color: "var(--crit)" }} />
              ) : (
                <span style={{ width: 10, height: 10, borderRadius: 5, border: "1.5px solid var(--text-muted)", display: "inline-block" }} />
              )}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span
                  style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {c.name}
                </span>
                <span data-testid="eval-kind-badge">
                  <Badge color={KIND_STYLE[e.kind].color} bg={KIND_STYLE[e.kind].bg} mono>
                    {t(`pipeline.cases.badge.${e.kind}`).toUpperCase()}
                  </Badge>
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{where(c)}</span> ·{" "}
                {c.latest === null
                  ? t("pipeline.cases.neverRun")
                  : s?.error
                    ? t("pipeline.cases.runError", { message: s.error })
                    : s
                      ? t("pipeline.cases.got", { kept: s.kept, hits: s.hits, noise: s.noise })
                      : status === "pass"
                        ? t("pipeline.cases.passed")
                        : t("pipeline.cases.failed")}
              </div>
            </div>
            <Badge mono>
              {e.severity} · {e.category}
            </Badge>
            {onRun && (
              <Button kind="secondary" size="sm" icon="Play" loading={running} disabled={running} onClick={() => onRun(c.id)}>
                {running ? t("pipeline.cases.running") : t("pipeline.cases.run")}
              </Button>
            )}
            {onEdit && (
              <Button kind="ghost" size="sm" icon="Edit" onClick={() => onEdit(c)}>
                {t("pipeline.cases.edit")}
              </Button>
            )}
            {onDelete && (
              <IconBtn icon="Trash" label={t("pipeline.cases.delete")} danger onClick={() => !deleting && onDelete(c.id)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
