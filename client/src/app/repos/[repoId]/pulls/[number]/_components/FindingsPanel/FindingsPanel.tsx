/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { EvalCaseDraft, FindingRecord } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { NewEvalCaseModal } from "../../../../../../../features/evals/ui/NewEvalCaseModal";
import { useEvalCaseDraft } from "../../../../../../../features/evals/api/hooks";
import { notify } from "../../../../../../../lib/toast";
import { ApiError } from "../../../../../../../lib/api";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { KEY_TO_ACTION } from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  severityFilter,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** When set, only findings of this severity are shown (page-level severity counter). */
  severityFilter?: string | null;
}) {
  const t = useTranslations("prReview");
  const te = useTranslations("eval");
  const action = useFindingAction();
  const evalDraft = useEvalCaseDraft();
  const [draft, setDraft] = React.useState<EvalCaseDraft | null>(null);
  /** Opens the "New eval case" modal seeded from the finding; nothing is stored until Save. */
  const turnIntoEval = (findingId: string) =>
    evalDraft.mutate(findingId, {
      onSuccess: setDraft,
      onError: (e) => {
        const code = e instanceof ApiError ? e.code : undefined;
        notify.error(
          code === "eval_case_exists"
            ? te("pipeline.toast.exists")
            : code === "finding_undecided"
              ? te("pipeline.toast.undecided")
              : code === "diff_unavailable"
                ? te("pipeline.toast.diff")
                : te("pipeline.modal.loadFailed"),
        );
      },
    });
  const [hideLow, setHideLow] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);

  const shown = React.useMemo(
    () => visibleFindings(findings, hideLow, severityFilter),
    [findings, hideLow, severityFilter],
  );

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onTurnIntoEval={() => turnIntoEval(f.id)}
              evalPending={evalDraft.isPending && evalDraft.variables === f.id}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
            />
          ))
        )}
      </div>
      {draft && <NewEvalCaseModal key={draft.source_finding_id} draft={draft} onClose={() => setDraft(null)} />}
    </div>
  );
}
