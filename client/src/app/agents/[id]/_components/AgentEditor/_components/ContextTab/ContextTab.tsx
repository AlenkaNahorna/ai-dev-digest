"use client";

import React from "react";
import { useActiveRepo } from "@/lib/repo-context";
import { ContextAttachmentList } from "@/features/project-context/ui/ContextAttachmentList";

/** Agent editor "Context" tab: attach repository documents to this agent (per active repo). */
export function ContextTab({ agentId }: { agentId: string }) {
  const { repoId } = useActiveRepo();
  return <ContextAttachmentList kind="agent" ownerId={agentId} repoId={repoId} />;
}
