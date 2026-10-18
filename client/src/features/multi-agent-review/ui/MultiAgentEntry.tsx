/* /multi-agent entry. Decides what the sidebar item shows:
   - ?pr=&run=            → the results of that run;
   - ?configure=1[&pr=]   → the Configure run screen (explicit "Configure run");
   - nothing              → the newest multi-agent review of the active repo if
                            there is one (show its findings), otherwise the
                            Configure run screen so the first run can be started. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/lib/repo-context";
import { useLatestMultiAgentRun } from "../api/hooks";
import { ConfigureRunScreen } from "./ConfigureRunScreen";
import { MultiAgentResultsScreen } from "./MultiAgentResultsScreen";

export function MultiAgentEntry({
  prId,
  parentId,
  configure,
}: {
  prId: string | null;
  parentId: string | null;
  configure: boolean;
}) {
  const t = useTranslations("multiAgent");
  const router = useRouter();
  const { repoId, reposLoaded } = useActiveRepo();

  const landing = !prId && !parentId && !configure;
  const latest = useLatestMultiAgentRun(repoId, landing && reposLoaded);
  const target = latest.data?.latest ?? null;

  React.useEffect(() => {
    if (landing && target) {
      router.replace(`/multi-agent?pr=${encodeURIComponent(target.pr_id)}&run=${encodeURIComponent(target.parent_id)}`);
    }
  }, [landing, target, router]);

  if (prId && parentId && !configure) return <MultiAgentResultsScreen prId={prId} parentId={parentId} />;

  if (landing && (!reposLoaded || latest.isLoading || target)) {
    return (
      <AppShell crumb={[{ label: t("results.title") }]}>
        <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 12, maxWidth: 740, margin: "0 auto" }}>
          <Skeleton height={28} width={320} />
          <Skeleton height={120} />
        </div>
      </AppShell>
    );
  }

  return <ConfigureRunScreen initialPrId={prId} />;
}
