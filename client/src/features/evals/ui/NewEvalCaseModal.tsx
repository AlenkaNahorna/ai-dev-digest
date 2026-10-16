"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, Tabs, TextInput, Toggle } from "@devdigest/ui";
import type { EvalCaseDraft, EvalTryResult, SkillPairResult } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { formatCost } from "@/lib/format-cost";
import { notify } from "@/lib/toast";
import { useCreateEvalCase, useTryEvalCase, useUpdateEvalCase } from "../api/hooks";
import { useCreateSkillEvalCase, useTrySkillCase } from "../api/skill-hooks";
import { diffFiles, formatExpectation, parseExpectationText } from "../lib/draft";

type Tab = "diff" | "files" | "meta";

const box: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 12,
  lineHeight: 1.5,
  padding: 10,
  background: "var(--bg-sunken, var(--bg-elevated))",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  resize: "vertical",
};

function runError(e: unknown, t: (k: string) => string): string {
  return e instanceof ApiError && e.code === "skill_not_linked" ? t("pipeline.skill.notLinked") : t("pipeline.modal.runFailed");
}

/** Pass/fail, counts, kept findings and cost of one trial run. */
function TrialResult({ result }: { result: EvalTryResult }) {
  const t = useTranslations("eval");
  return (
      <>
        <div style={{ fontWeight: 700, color: result.pass ? "var(--ok)" : "var(--crit)" }}>
          {result.pass ? t("pipeline.modal.result.pass") : t("pipeline.modal.result.fail")}
        </div>
        {result.output.error ? (
          <div style={{ color: "var(--crit)" }}>{t("pipeline.modal.result.error", { message: result.output.error })}</div>
        ) : (
          <>
            <div>{t("pipeline.modal.result.counts", {
                emitted: result.output.emitted,
                kept: result.output.kept,
                dropped: result.output.dropped,
                hits: result.output.hits,
                noise: result.output.noise,
              })}</div>
            <div style={{ marginTop: 6 }}>{t("pipeline.modal.result.findings")}:</div>
            {result.output.findings.length === 0 ? (
              <div>{t("pipeline.modal.result.none")}</div>
            ) : (
              result.output.findings.map((f, i) => (
                <div key={i}>
                  {f.severity} · {f.file}:{f.start_line === f.end_line ? f.start_line : `${f.start_line}-${f.end_line}`} · {f.title}
                </div>
              ))
            )}
          </>
        )}
        <div style={{ marginTop: 6, color: "var(--text-muted)" }}>
          {t("pipeline.modal.result.cost", { cost: formatCost(result.cost_usd) })} ·{" "}
          {t("pipeline.modal.result.duration", { seconds: (result.duration_ms / 1000).toFixed(1) })} · {result.provider}/{result.model}
        </div>
        <div style={{ color: "var(--text-muted)" }}>{t("pipeline.modal.result.notStored")}</div>
      </>
  );
}

/**
 * "New eval case" — opened from a decided finding. Seeded with the finding's diff fragment and
 * expectation; the user can edit all of it, trial-run it on this single case ("Run case") and save.
 */
export function NewEvalCaseModal({
  draft,
  caseId,
  skill,
  onClose,
}: {
  draft: EvalCaseDraft;
  /** Set → a skill's case: it runs with and without that skill and Save needs no finding. */
  skill?: { id: string; name: string };
  /** Set → "Edit" of a stored case: Save updates it instead of creating one. */
  caseId?: string;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const create = useCreateEvalCase();
  const update = useUpdateEvalCase();
  const editing = caseId !== undefined;
  const tryCase = useTryEvalCase(draft.agent_id);
  const trySkill = useTrySkillCase(skill?.id);
  const createSkill = useCreateSkillEvalCase(skill?.id);
  const isRunning = tryCase.isPending || trySkill.isPending;
  const seeded = React.useMemo(() => formatExpectation(draft.expectation), [draft.expectation]);

  const [name, setName] = React.useState(draft.name);
  const [diff, setDiff] = React.useState(draft.input_diff);
  const [text, setText] = React.useState(seeded);
  const [tab, setTab] = React.useState<Tab>("diff");
  const [runOnSave, setRunOnSave] = React.useState(false);
  const [result, setResult] = React.useState<EvalTryResult | null>(null);
  const [pair, setPair] = React.useState<SkillPairResult | null>(null);
  const [saved, setSaved] = React.useState(false);

  const parsed = React.useMemo(() => parseExpectationText(text), [text]);
  const files = React.useMemo(() => diffFiles(diff), [diff]);
  const kind = parsed.ok ? parsed.value.kind : draft.expectation.kind;
  const where = parsed.ok
    ? `${parsed.value.file}:${parsed.value.start_line === parsed.value.end_line ? parsed.value.start_line : `${parsed.value.start_line}-${parsed.value.end_line}`}`
    : `${draft.expectation.file}:${draft.expectation.start_line}`;
  const title = parsed.ok ? parsed.value.title : draft.expectation.title;
  const ready = parsed.ok && name.trim() !== "" && diff.trim() !== "";

  const run = () => {
    if (!parsed.ok) return;
    if (skill) {
      trySkill.mutate(
        { expectation: parsed.value, input_diff: diff },
        { onSuccess: setPair, onError: (e) => notify.error(runError(e, t)) },
      );
      return;
    }
    tryCase.mutate(
      { expectation: parsed.value, input_diff: diff },
      { onSuccess: setResult, onError: () => notify.error(t("pipeline.modal.runFailed")) },
    );
  };

  const save = () => {
    if (!parsed.ok) return;
    const overrides = { name: name.trim(), expectation: parsed.value, input_diff: diff };
    const done = (toast: string) => {
      notify.success(toast);
      if (runOnSave) {
        setSaved(true);
        run();
      } else onClose();
    };
    if (caseId) {
      update.mutate(
        { caseId, overrides },
        { onSuccess: () => done(t("pipeline.toast.updated")), onError: () => notify.error(t("pipeline.modal.saveFailed")) },
      );
      return;
    }
    if (skill) {
      createSkill.mutate(overrides, {
        onSuccess: () => done(t("pipeline.toast.created")),
        onError: () => notify.error(t("pipeline.modal.saveFailed")),
      });
      return;
    }
    create.mutate(
      { findingId: draft.source_finding_id, overrides },
      {
        onSuccess: () => done(t("pipeline.toast.created")),
        onError: (e) => {
          const code = e instanceof ApiError ? e.code : undefined;
          notify.error(code === "eval_case_exists" ? t("pipeline.toast.exists") : t("pipeline.modal.saveFailed"));
        },
      },
    );
  };

  const th = (invalid: string) => t(`pipeline.modal.invalid.${invalid}` as never);

  return (
    <Modal
      width={1040}
      title={editing ? t("pipeline.modal.editTitle") : t("pipeline.modal.title")}
      subtitle={
        skill
          ? t("pipeline.skill.modalSubtitle", { skill: skill.name })
          : editing
          ? t("pipeline.modal.editSubtitle")
          : t("pipeline.modal.subtitle", {
              decision: t(`pipeline.modal.decision.${draft.expectation.kind === "must_find" ? "accepted" : "dismissed"}` as never),
            })
      }
      onClose={onClose}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
          <Toggle on={runOnSave} onChange={setRunOnSave} />
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("pipeline.modal.runOnSave")}</span>
          <span style={{ flex: 1 }} />
          <Button kind="ghost" onClick={onClose}>
            {saved ? t("pipeline.compare.close") : t("pipeline.modal.cancel")}
          </Button>
          <Button kind="secondary" icon="Play" disabled={!ready || isRunning} loading={isRunning} onClick={run}>
            {t("pipeline.modal.runCase")}
          </Button>
          <Button kind="primary" disabled={!ready || create.isPending || createSkill.isPending || update.isPending || saved} loading={create.isPending || createSkill.isPending || update.isPending} onClick={save}>
            {create.isPending || createSkill.isPending || update.isPending ? t("pipeline.modal.saving") : editing ? t("pipeline.modal.update") : t("pipeline.modal.save")}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* left: what the case is + its input */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            data-testid="eval-case-kind"
            style={{
              padding: "10px 14px",
              marginBottom: 16,
              border: "1px solid var(--accent)",
              borderRadius: 8,
              background: "var(--accent-bg, transparent)",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: "var(--accent)" }}>
              {(kind === "must_find" ? t("pipeline.modal.positive") : t("pipeline.modal.negative")).toUpperCase()}
            </div>
            <div style={{ fontSize: 13, marginTop: 2 }}>
              {kind === "must_find"
                ? t("pipeline.modal.mustFind", { title, where })
                : t("pipeline.modal.mustNotFlag", { title, where })}
            </div>
          </div>

          <FormField label={t("pipeline.modal.name")} required>
            <TextInput value={name} onChange={setName} aria-label={t("pipeline.modal.name")} />
          </FormField>

          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
            {t("pipeline.modal.input")}
          </div>
          <Tabs
            pad="0"
            value={tab}
            onChange={(k) => setTab(k as Tab)}
            tabs={[
              { key: "diff", label: t("pipeline.modal.tabs.diff") },
              { key: "files", label: t("pipeline.modal.tabs.files") },
              { key: "meta", label: t("pipeline.modal.tabs.meta") },
            ]}
          />
          <div style={{ marginTop: 10 }}>
            {tab === "diff" && (
              <>
                <textarea
                  aria-label={t("pipeline.modal.tabs.diff")}
                  value={diff}
                  onChange={(e) => setDiff(e.target.value)}
                  rows={14}
                  spellCheck={false}
                  style={box}
                />
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{t("pipeline.modal.diffHint")}</div>
              </>
            )}
            {tab === "files" &&
              (files.length === 0 ? (
                <div style={{ fontSize: 13 }}>{t("pipeline.modal.filesEmpty")}</div>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}>
                  {files.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              ))}
            {tab === "meta" && (
              <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "110px 1fr", rowGap: 6, fontSize: 13 }}>
                {skill ? (
                  <>
                    <dt style={{ color: "var(--text-muted)" }}>{t("pipeline.skill.skill")}</dt>
                    <dd style={{ margin: 0 }}>{skill.name}</dd>
                  </>
                ) : null}
                <dt style={{ color: "var(--text-muted)" }}>{t("pipeline.modal.meta.agent")}</dt>
                <dd style={{ margin: 0 }}>{draft.agent_name || "—"}</dd>
                <dt style={{ color: "var(--text-muted)" }}>{t("pipeline.modal.meta.model")}</dt>
                <dd style={{ margin: 0 }}>
                  {draft.provider}/{draft.model}
                </dd>
                <dt style={{ color: "var(--text-muted)" }}>{t("pipeline.modal.meta.pr")}</dt>
                <dd style={{ margin: 0, fontFamily: "var(--font-mono, monospace)" }}>{draft.source_pr_id}</dd>
                <dt style={{ color: "var(--text-muted)" }}>{t("pipeline.modal.meta.finding")}</dt>
                <dd style={{ margin: 0, fontFamily: "var(--font-mono, monospace)" }}>{draft.source_finding_id}</dd>
              </dl>
            )}
          </div>
        </div>

        {/* right: expectation + trial result */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", flex: 1 }}>
              {t("pipeline.modal.expected")}
            </span>
            <span
              data-testid="eval-json-status"
              role="status"
              style={{ fontSize: 12, color: parsed.ok ? "var(--ok)" : "var(--crit)" }}
            >
              {parsed.ok ? `✓ ${t("pipeline.modal.validJson")}` : th(parsed.error)}
            </span>
            <Button kind="ghost" size="sm" icon="Plus" onClick={() => setText(seeded)}>
              {t("pipeline.modal.skeleton")}
            </Button>
          </div>
          <textarea
            aria-label={t("pipeline.modal.expected")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            spellCheck={false}
            style={box}
          />

          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", margin: "16px 0 6px" }}>
            {t("pipeline.modal.actual")}
          </div>
          <div data-testid="eval-actual" style={{ ...box, minHeight: 200, resize: "none", whiteSpace: "pre-wrap" }}>
            {isRunning ? (
              t("pipeline.modal.running")
            ) : skill ? (
              !pair ? (
                <span style={{ color: "var(--text-muted)" }}>{t("pipeline.modal.neverRun")}</span>
              ) : (
                <>
                  <div style={{ color: "var(--text-muted)", marginBottom: 6 }}>
                    {t("pipeline.skill.runOn", { agent: pair.agent_name, model: `${pair.provider}/${pair.model}` })}
                  </div>
                  <div data-testid="eval-with-skill" style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 700 }}>{t("pipeline.skill.withSkill")}</div>
                    <TrialResult result={pair.with_skill} />
                  </div>
                  <div data-testid="eval-without-skill">
                    <div style={{ fontWeight: 700 }}>{t("pipeline.skill.withoutSkill")}</div>
                    <TrialResult result={pair.without_skill} />
                  </div>
                </>
              )
            ) : !result ? (
              <span style={{ color: "var(--text-muted)" }}>{t("pipeline.modal.neverRun")}</span>
            ) : (
              <TrialResult result={result} />
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
