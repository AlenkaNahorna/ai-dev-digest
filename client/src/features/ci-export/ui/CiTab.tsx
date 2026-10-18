"use client";

import React from "react";
import { useActiveRepo } from "@/lib/repo-context";
import { useAgent, useUpdateAgent } from "@/lib/hooks/agents";
import type { CiFailOn } from "@devdigest/shared";
import { useCiHistory, useCiInstallations } from "../api/hooks";
import { CiTabView } from "./CiTabView";
import { CiExportWizard } from "./CiExportWizard";

/**
 * CI tab of the Agent Editor (hook-owning). Lists the agent's installations and
 * history, edits the agent's "Fail CI on" gate, and opens the Export wizard —
 * for a new repo ("Add to CI", pre-filled from the active repo) or for an
 * installed one ("Update CI config", pre-filled with that repo).
 */
export function CiTab({ agentId }: { agentId: string }) {
  const installations = useCiInstallations(agentId);
  const history = useCiHistory(agentId);
  const agent = useAgent(agentId);
  const updateAgent = useUpdateAgent();
  const { activeRepo } = useActiveRepo();
  const [wizard, setWizard] = React.useState<{ repo?: string } | null>(null);

  const failOn = agent.data?.ci_fail_on;

  return (
    <>
      <CiTabView
        installations={installations.data}
        history={history.data}
        isLoading={installations.isLoading}
        isError={installations.isError}
        failOn={failOn}
        failOnSaving={updateAgent.isPending}
        failOnError={updateAgent.isError}
        onRetry={() => void installations.refetch()}
        onAddToCi={() => setWizard({ repo: activeRepo?.full_name })}
        onUpdateConfig={(repo) => setWizard({ repo })}
        onFailOnChange={(v) => updateAgent.mutate({ id: agentId, patch: { ci_fail_on: v as CiFailOn } })}
      />
      {wizard && (
        <CiExportWizard
          agentId={agentId}
          agentName={agent.data?.name}
          defaultRepo={wizard.repo}
          failOn={failOn}
          onClose={() => setWizard(null)}
        />
      )}
    </>
  );
}
