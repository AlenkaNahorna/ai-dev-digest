"use client";

import React from "react";
import { useActiveRepo } from "@/lib/repo-context";
import { useCiInstallations } from "../api/hooks";
import { CiTabView } from "./CiTabView";
import { CiExportDialog } from "./CiExportDialog";

/**
 * CI tab of the Agent Editor (hook-owning). Lists the agent's installations and
 * opens the single "Add to CI" dialog. Pre-fills the dialog's repo field from
 * the active repo as a convenience (AC-1, AC-2).
 */
export function CiTab({ agentId }: { agentId: string }) {
  const { data, isLoading, isError, refetch } = useCiInstallations(agentId);
  const { activeRepo } = useActiveRepo();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  return (
    <>
      <CiTabView
        installations={data}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        onAddToCi={() => setDialogOpen(true)}
      />
      {dialogOpen && (
        <CiExportDialog
          agentId={agentId}
          defaultRepo={activeRepo?.full_name}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  );
}
