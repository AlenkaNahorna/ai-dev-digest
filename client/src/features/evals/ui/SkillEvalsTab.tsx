"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, Icon, IconBtn } from "@devdigest/ui";
import type { EvalCaseDraft, SkillEvalCaseRecord } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { notify } from "@/lib/toast";
import { useDeleteEvalCase } from "../api/hooks";
import { useRunSkillEvalCase, useRunSkillEvals, useSkillEvalCases } from "../api/skill-hooks";
import { NewEvalCaseModal } from "./NewEvalCaseModal";

const KIND_STYLE = {
  must_find: { color: "var(--accent)", bg: "var(--accent-bg, var(--bg-hover))" },
  must_not_flag: { color: "var(--ok)", bg: "var(--ok-bg, var(--bg-hover))" },
} as const;

const SKELETON: EvalCaseDraft["expectation"] = {
  kind: "must_find",
  file: "src/example.ts",
  start_line: 1,
  end_line: 1,
  severity: "WARNING",
  category: "bug",
  title: "Describe the expected finding",
};

function pct(v: boolean | undefined): string {
  return v ? "100%" : "0%";
}

function toDraft(skillName: string, c?: SkillEvalCaseRecord): EvalCaseDraft {
  return {
    agent_id: "",
    agent_name: "",
    provider: "",
    model: "",
    name: c?.name ?? "",
    expectation: c?.expectation ?? SKELETON,
    input_diff: c?.input_diff ?? "",
    source_finding_id: "",
    source_pr_id: "",
  };
}

/** Evals tab of a skill: cases judged with vs without the skill, all row actions. */
export function SkillEvalsTab({ skillId, skillName }: { skillId: string; skillName: string }) {
  const t = useTranslations("eval");
  const cases = useSkillEvalCases(skillId);
  const runAll = useRunSkillEvals(skillId);
  const runOne = useRunSkillEvalCase(skillId);
  const del = useDeleteEvalCase();
  const [modal, setModal] = React.useState<{ caseId?: string; draft: EvalCaseDraft } | null>(null);
  const list = cases.data?.cases ?? [];

  const fail = (e: unknown) =>
    notify.error(e instanceof ApiError && e.code === "skill_not_linked" ? t("pipeline.skill.notLinked") : t("pipeline.cases.runFailed"));

  const onRunAll = () =>
    runAll.mutate(undefined, {
      onSuccess: (d) => notify.success(t("pipeline.skill.runDone", { withSkill: d.passing_with_skill, total: d.total })),
      onError: fail,
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>
          {t("pipeline.cases.heading")}
          {cases.data && (
            <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: 8 }}>
              {t("pipeline.cases.passing", { passing: cases.data.passing, total: list.length })} ·{" "}
              {t("pipeline.skill.caseCount", { count: list.length })}
            </span>
          )}
        </h3>
        <span style={{ flex: 1 }} />
        <Button kind="secondary" icon="Plus" onClick={() => setModal({ draft: toDraft(skillName) })}>
          {t("pipeline.skill.newCase")}
        </Button>
        <Button kind="primary" icon="Play" loading={runAll.isPending} disabled={list.length === 0 || runAll.isPending} onClick={onRunAll}>
          {runAll.isPending ? t("pipeline.tab.running") : t("pipeline.tab.runAll")}
        </Button>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("pipeline.skill.hint")}</div>

      {cases.isLoading ? (
        <div>{t("pipeline.cases.loading")}</div>
      ) : cases.isError ? (
        <div role="alert">{t("pipeline.cases.error")}</div>
      ) : list.length === 0 ? (
        <EmptyState icon="FlaskConical" title={t("pipeline.cases.heading")} body={t("pipeline.skill.empty")} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {list.map((c) => {
            const l = c.latest;
            const status = l === null ? "never" : l.with_skill?.pass ? "pass" : "fail";
            const running = runOne.isPending && runOne.variables === c.id;
            return (
              <div
                key={c.id}
                data-testid="skill-eval-case"
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8 }}
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
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.name}
                    </span>
                    <span data-testid="eval-kind-badge">
                      <Badge color={KIND_STYLE[c.expectation.kind].color} bg={KIND_STYLE[c.expectation.kind].bg} mono>
                        {t(`pipeline.cases.badge.${c.expectation.kind}`).toUpperCase()}
                      </Badge>
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                    {l === null
                      ? t("pipeline.cases.neverRun")
                      : t("pipeline.skill.rowResult", {
                          expected: 1,
                          got: l.with_skill?.summary?.kept ?? 0,
                          withSkill: pct(l.with_skill?.pass),
                          withoutSkill: pct(l.without_skill?.pass),
                        })}
                  </div>
                </div>
                <Button
                  kind="secondary"
                  size="sm"
                  icon="Play"
                  loading={running}
                  disabled={running}
                  onClick={() => runOne.mutate(c.id, { onError: fail })}
                >
                  {running ? t("pipeline.cases.running") : t("pipeline.cases.run")}
                </Button>
                <Button kind="ghost" size="sm" icon="Edit" onClick={() => setModal({ caseId: c.id, draft: toDraft(skillName, c) })}>
                  {t("pipeline.cases.edit")}
                </Button>
                <IconBtn icon="Trash" label={t("pipeline.cases.delete")} danger onClick={() => !del.isPending && del.mutate(c.id)} />
              </div>
            );
          })}
        </div>
      )}
      {modal && (
        <NewEvalCaseModal
          key={modal.caseId ?? "new"}
          caseId={modal.caseId}
          draft={modal.draft}
          skill={{ id: skillId, name: skillName }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
