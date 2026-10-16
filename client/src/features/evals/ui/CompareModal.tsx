"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import type { EvalBatchSummary } from "@devdigest/shared";
import { formatCost } from "@/lib/format-cost";
import { useEvalCompare } from "../api/hooks";
import { deltaPoints, pct, versionLabel } from "../lib/format";
import { diffLines } from "../lib/line-diff";

const TONE = { up: "var(--ok)", down: "var(--crit)", flat: "var(--text-muted)", none: "var(--text-muted)" } as const;

/** Old run vs new run: metric deltas, per-case changes and the system-prompt diff (AC-35). */
export function CompareModal({ a, b, onClose }: { a: EvalBatchSummary; b: EvalBatchSummary; onClose: () => void }) {
  const t = useTranslations("eval");
  const { data, isLoading, isError } = useEvalCompare(a.batch_id, b.batch_id);
  const title = t("pipeline.compare.title", { a: versionLabel(a.agent_version), b: versionLabel(b.agent_version) });

  const rows = data
    ? ([
        ["recall", data.a.recall, data.b.recall, data.delta.recall],
        ["precision", data.a.precision, data.b.precision, data.delta.precision],
        ["citation", data.a.citation_accuracy, data.b.citation_accuracy, data.delta.citation_accuracy],
      ] as const)
    : [];
  const pa = data?.config_a.system_prompt ?? null;
  const pb = data?.config_b.system_prompt ?? null;
  const changed = data ? data.cases.filter((c) => c.a !== null && c.b !== null && c.a !== c.b) : [];

  return (
    <Modal
      width={760}
      title={title}
      subtitle={t("pipeline.compare.subtitle")}
      onClose={onClose}
      footer={
        <Button kind="secondary" onClick={onClose}>
          {t("pipeline.compare.close")}
        </Button>
      }
    >
      {isLoading && <div>{t("pipeline.compare.loading")}</div>}
      {isError && <div role="alert">{t("pipeline.compare.error")}</div>}
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 10 }}>
            {rows.map(([key, from, to, delta]) => {
              const d = deltaPoints(delta);
              return (
                <div key={key} data-testid={`compare-${key}`} style={{ flex: 1, padding: 12, border: "1px solid var(--border)", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{t(`pipeline.metrics.${key}`).toUpperCase()}</div>
                  <div style={{ fontSize: 18, marginTop: 4 }}>
                    {pct(from)} → <strong>{pct(to)}</strong> <span style={{ fontSize: 12, color: TONE[d.tone] }}>{d.text}</span>
                  </div>
                </div>
              );
            })}
            <div style={{ flex: 1, padding: 12, border: "1px solid var(--border)", borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{t("pipeline.compare.cost").toUpperCase()}</div>
              <div style={{ fontSize: 18, marginTop: 4 }}>
                {formatCost(data.a.cost_usd)} → <strong>{formatCost(data.b.cost_usd)}</strong>
              </div>
            </div>
          </div>

          {data.config_a.model !== data.config_b.model && (
            <div style={{ fontSize: 13 }}>{t("pipeline.compare.model", { from: data.config_a.model ?? "—", to: data.config_b.model ?? "—" })}</div>
          )}

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>{t("pipeline.compare.promptDiff").toUpperCase()}</div>
            {pa === null || pb === null ? (
              <div style={{ fontSize: 13 }}>{t("pipeline.compare.promptMissing")}</div>
            ) : pa === pb ? (
              <div style={{ fontSize: 13 }}>{t("pipeline.compare.promptSame")}</div>
            ) : (
              <pre data-testid="prompt-diff" style={{ margin: 0, padding: 12, background: "var(--bg-sunken, var(--bg-hover))", borderRadius: 8, fontSize: 12, whiteSpace: "pre-wrap" }}>
                {diffLines(pa, pb).map((l, i) => (
                  <div
                    key={i}
                    data-kind={l.kind}
                    style={{ background: l.kind === "add" ? "var(--ok-bg)" : l.kind === "del" ? "var(--crit-bg)" : "transparent" }}
                  >
                    {l.kind === "add" ? "+ " : l.kind === "del" ? "− " : "  "}
                    {l.text}
                  </div>
                ))}
              </pre>
            )}
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>{t("pipeline.compare.cases").toUpperCase()}</div>
            {changed.length === 0 ? (
              <div style={{ fontSize: 13 }}>{t("pipeline.compare.noCaseChanges")}</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {changed.map((c) => (
                  <li key={c.case_id}>
                    <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{c.case_name}</span> —{" "}
                    {c.b ? t("pipeline.compare.nowPassing") : t("pipeline.compare.nowFailing")}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
