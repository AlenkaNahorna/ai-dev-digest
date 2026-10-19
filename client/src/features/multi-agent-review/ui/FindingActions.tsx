/* Accept / Dismiss buttons plus the disabled "not available yet" placeholders
   (Learn / Turn into eval case — D10, AC-45). Accept/Dismiss
   call the existing POST /findings/:id/(accept|dismiss) via useFindingAction;
   when `findingIds` has more than one entry the action fires on every original
   (group action — D12, AC-46). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { useFindingAction } from "@/features/reviews/api/hooks";
import { notify } from "@/lib/toast";

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

  // One in-flight group action at a time: `action.isPending` only tracks the latest
  // of several parallel mutations, so rapid clicks could otherwise interleave.
  const [busy, setBusy] = React.useState(false);

  const run = async (kind: "accept" | "dismiss") => {
    if (busy) return;
    setBusy(true);
    try {
      const results = await Promise.allSettled(
        findingIds.map((findingId) => action.mutateAsync({ findingId, action: kind, ...(prId ? { prId } : {}) })),
      );
      // A group action can partly succeed: tell the user instead of failing silently.
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) notify.error(t("finding.partialFailure", { failed, total: findingIds.length }));
    } finally {
      setBusy(false);
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
      <Button kind="secondary" size="sm" icon="Check" disabled={busy} onClick={() => void run("accept")}>
        {isGroup ? t("finding.acceptGroup") : t("finding.accept")}
      </Button>
      <Button kind="ghost" size="sm" icon="X" disabled={busy} onClick={() => void run("dismiss")}>
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
