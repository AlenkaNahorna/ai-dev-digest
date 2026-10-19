/* "Where agents disagree" (AC-29..34). One row per flagged file:line, each
   agent's take shown as TEXT (severity label, "did not flag", or "no result").
   A location where every reviewing agent agreed is still listed but labelled
   "Agreed"; "Show only conflicts" hides those (AC-33). Notes come from the
   server as neutral derived text and are rendered plain, never as HTML or
   Markdown (security A05, AC-32/57). */
"use client";

import { useTranslations } from "next-intl";
import { Badge, Button, Card, SeverityBadge, Toggle, type Severity } from "@devdigest/ui";
import type { Conflict, ConflictTake } from "@devdigest/shared";

function TakeVerdict({ take, runId, onViewTrace }: { take: ConflictTake; runId?: string; onViewTrace: (runId: string) => void }) {
  const t = useTranslations("multiAgent");
  if (take.verdict === "ignored") {
    // "did not flag" — offer a jump to that agent's trace when it resolves to a run.
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
        {t("conflicts.ignored")}
        {runId && (
          <Button kind="ghost" size="sm" icon="Eye" onClick={() => onViewTrace(runId)}>
            {t("conflicts.viewTrace")}
          </Button>
        )}
      </span>
    );
  }
  if (take.verdict === "no_result") {
    return <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("conflicts.noResult")}</span>;
  }
  return <SeverityBadge severity={take.verdict as Severity} compact />;
}

export function ConflictsBlock({
  conflicts,
  showOnlyConflicts,
  onToggleShowOnly,
  runIdForAgent,
  onViewTrace,
}: {
  conflicts: Conflict[];
  showOnlyConflicts: boolean;
  onToggleShowOnly: (v: boolean) => void;
  /** Resolve an agent's column run_id; undefined → no trace to open. */
  runIdForAgent: (agentId: string) => string | undefined;
  onViewTrace: (runId: string) => void;
}) {
  const t = useTranslations("multiAgent");
  const shown = showOnlyConflicts ? conflicts.filter((c) => c.is_conflict) : conflicts;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>{t("conflicts.heading")}</h2>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          {t("conflicts.showOnly")}
          <Toggle on={showOnlyConflicts} onChange={onToggleShowOnly} />
        </label>
      </div>

      {shown.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)" }}>
          {conflicts.length === 0 ? t("conflicts.noneFlagged") : t("conflicts.none")}
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {shown.map((c) => (
            <li key={`${c.file}:${c.line}`}>
              <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {c.file}:{c.line}
                  </span>
                  {/* Plain text: titles come from the model. */}
                  <strong style={{ fontSize: 13 }}>{c.title}</strong>
                  <Badge bg="transparent" color={c.is_conflict ? "var(--warn)" : "var(--ok)"}>
                    {c.is_conflict ? t("conflicts.labelConflict") : t("conflicts.labelAgreed")}
                  </Badge>
                </div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {c.takes.map((take) => (
                    <li key={take.agent_id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Badge bg="transparent" color="var(--text-secondary)">{take.persona}</Badge>
                      <TakeVerdict take={take} runId={runIdForAgent(take.agent_id)} onViewTrace={onViewTrace} />
                      {take.note && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{take.note}</span>}
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
