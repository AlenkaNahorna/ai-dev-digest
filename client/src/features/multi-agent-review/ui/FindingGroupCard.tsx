/* A cross-agent finding group, collapsed by default (AC-23). The header shows a
   representative finding; expanding reveals every original. Accept/Dismiss acts
   on every original in the group (D12, AC-46). A group of one is just a finding. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Card } from "@devdigest/ui";
import type { ResolvedGroup } from "../model/groups";
import { FindingBody } from "./FindingBody";
import { FindingActions } from "./FindingActions";

/** Collapse the group's shared state to a single value, else "open" (actionable). */
function groupState(group: ResolvedGroup): "open" | "accepted" | "dismissed" {
  const states = new Set(group.findings.map((f) => f.state));
  const only = [...states][0];
  if (states.size === 1 && only) return only;
  return "open";
}

export function FindingGroupCard({
  group,
  agentName,
  prId,
}: {
  group: ResolvedGroup;
  /** run_id → agent name, for per-original attribution. */
  agentName: (agentId: string) => string;
  prId: string | null;
}) {
  const t = useTranslations("multiAgent");
  const [expanded, setExpanded] = React.useState(false);
  const isGroup = group.findings.length > 1;
  const head = group.findings[0];
  if (!head) return null;

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <FindingBody finding={head} showAgent={isGroup ? null : agentName(head.agent_id)} />

      {isGroup && (
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t("group.sharedBy", { count: group.agentIds.length })}
        </span>
      )}

      {isGroup && (
        <div>
          <Button kind="ghost" size="sm" iconRight={expanded ? "ChevronDown" : "ChevronRight"} onClick={() => setExpanded((e) => !e)}>
            {expanded ? t("group.collapse") : t("group.expand")}
          </Button>
        </div>
      )}

      {isGroup && expanded && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {group.findings.map((f) => (
            <li key={f.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <FindingBody finding={f} showAgent={agentName(f.agent_id)} />
            </li>
          ))}
        </ul>
      )}

      <FindingActions findingIds={group.findings.map((f) => f.id)} prId={prId} state={groupState(group)} isGroup={isGroup} />
    </Card>
  );
}
