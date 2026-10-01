"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import {
  DiffViewer,
  type DiffCommentApi,
  type DiffFindingApi,
  type DiffGroupView,
} from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { usePrReviews, useSmartDiff, useFindingAction } from "@/features/reviews/api/hooks";
import { notify } from "@/lib/toast";
import type { FindingRecord, PrFile } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { buildDiffGroups, latestFindings } from "./helpers";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
}

type Order = "smart" | "original";

export function DiffTab({ prId, filesCount, files, canComment }: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const { data: reviews } = usePrReviews(prId);
  const { data: smart } = useSmartDiff(prId);
  const create = useCreatePrComment(prId);
  const action = useFindingAction();
  const [order, setOrder] = React.useState<Order>("smart");
  // null = the user has not chosen; default is visible once findings exist.
  const [userChoice, setUserChoice] = React.useState<boolean | null>(null);

  const findings = React.useMemo(() => latestFindings(reviews), [reviews]);
  const commentCount = comments?.length ?? 0;
  const hiddenCount = commentCount + findings.length;
  const showComments = userChoice ?? findings.length > 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setUserChoice(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  const findingApi: DiffFindingApi = {
    findings,
    showCards: showComments,
    renderFinding: (f: FindingRecord) => (
      <FindingCard
        f={f}
        defaultExpanded
        pending={action.isPending && action.variables?.findingId === f.id}
        onAction={(a) =>
          action.mutate(
            { findingId: f.id, action: a, prId: prId ?? undefined },
            { onError: (e) => notify.error(e instanceof Error ? e.message : t("smartDiff.actionFailed")) },
          )
        }
      />
    ),
  };

  // Grouping is best-effort: while loading / on error we silently show Original order.
  const grouped = React.useMemo(() => (smart ? buildDiffGroups(files, smart, findings) : null), [files, smart, findings]);
  const smartActive = order === "smart" && !!grouped;
  const groups: DiffGroupView[] | undefined = smartActive
    ? grouped.groups.map((g) => ({
        ...g,
        label: t(`smartDiff.${g.role}Label`),
        hint: t(`smartDiff.${g.role}Hint`),
      }))
    : undefined;

  const additions = files.reduce((n, f) => n + (f.additions ?? 0), 0);
  const deletions = files.reduce((n, f) => n + (f.deletions ?? 0), 0);

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          hiddenCount > 0 ? (
            <Button
              kind="ghost"
              size="sm"
              icon={showComments ? "EyeOff" : "Eye"}
              onClick={() => setUserChoice(!showComments)}
            >
              {showComments ? t("smartDiff.hideComments") : t("smartDiff.showComments")} ({hiddenCount})
            </Button>
          ) : undefined
        }
      >
        {t("smartDiff.reviewerOrderedDiff")}
      </SectionLabel>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "8px 0 14px" }}>
        <span className="mono tnum" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {filesCount} files · <span style={{ color: "var(--code-add-text)" }}>+{additions}</span>{" "}
          <span style={{ color: "var(--code-del-text)" }}>−{deletions}</span>
        </span>
        <div
          role="group"
          aria-label={t("smartDiff.reviewerOrderedDiff")}
          style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 7, padding: 2, gap: 2 }}
        >
          {(["smart", "original"] as const).map((o) => (
            <Button
              key={o}
              kind={smartActive === (o === "smart") ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={smartActive === (o === "smart")}
              disabled={!grouped}
              onClick={() => setOrder(o)}
            >
              {o === "smart" ? t("smartDiff.orderSmart") : t("smartDiff.orderOriginal")}
            </Button>
          ))}
        </div>
      </div>
      <DiffViewer
        files={files}
        commenting={commenting}
        findingApi={findingApi}
        groups={groups}
        ungrouped={smartActive ? grouped.ungrouped : undefined}
      />
    </section>
  );
}
