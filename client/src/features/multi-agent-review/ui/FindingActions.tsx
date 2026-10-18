/* Accept / Dismiss buttons plus the disabled "not available yet" placeholders
   (Learn / Turn into eval case — D10, AC-45). Accept/Dismiss
   call the existing POST /findings/:id/(accept|dismiss) via useFindingAction;
   when `findingIds` has more than one entry the action fires on every original
   (group action — D12, AC-46). */
"use client";

import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { useFindingAction } from "@/features/reviews/api/hooks";

const DISABLED_ACTIONS = ["learn", "turnIntoEval"] as const;

export function FindingActions({
  findingIds,
  prId,
  state,
  isGroup = false,
}: {
  findingIds: string[];
  prId: string | null;
  /** When every original shares one state, show it; otherwise undefined. */
  state?: "open" | "accepted" | "dismissed";
  isGroup?: boolean;
}) {
  const t = useTranslations("multiAgent");
  const action = useFindingAction();

  const run = (kind: "accept" | "dismiss") => {
    for (const findingId of findingIds) {
      action.mutate({ findingId, action: kind, ...(prId ? { prId } : {}) });
    }
  };

  if (state && state !== "open") {
    return (
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
        {state === "accepted" ? t("finding.accepted") : t("finding.dismissed")}
      </span>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <Button kind="secondary" size="sm" icon="Check" disabled={action.isPending} onClick={() => run("accept")}>
        {isGroup ? t("finding.acceptGroup") : t("finding.accept")}
      </Button>
      <Button kind="ghost" size="sm" icon="X" disabled={action.isPending} onClick={() => run("dismiss")}>
        {isGroup ? t("finding.dismissGroup") : t("finding.dismiss")}
      </Button>
      {DISABLED_ACTIONS.map((key) => (
        <span key={key} title={t("finding.notAvailable")}>
          <Button kind="ghost" size="sm" disabled>
            {t(`finding.${key}`)}
          </Button>
        </span>
      ))}
    </div>
  );
}
