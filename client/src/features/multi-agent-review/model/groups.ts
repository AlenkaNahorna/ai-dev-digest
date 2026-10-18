/* Resolve the server-computed finding groups (ids only) into renderable groups
   of the actual AgentColumnFinding objects (AC-22/23). The server owns the
   grouping logic; the client only maps ids → findings and derives a display
   label. A group of one id is an ungrouped finding. */

import type { AgentColumn, AgentColumnFinding, FindingGroup } from "@devdigest/shared";

export interface ResolvedGroup {
  key: string;
  findings: AgentColumnFinding[];
  /** Distinct producing agents in this group. */
  agentIds: string[];
}

/** Flatten all columns' findings into an id → finding lookup. */
function findingIndex(columns: AgentColumn[]): Map<string, AgentColumnFinding> {
  const index = new Map<string, AgentColumnFinding>();
  for (const col of columns) for (const f of col.findings) index.set(f.id, f);
  return index;
}

export function resolveGroups(groups: FindingGroup[], columns: AgentColumn[]): ResolvedGroup[] {
  const index = findingIndex(columns);
  return groups.map((g) => {
    const findings = g.finding_ids
      .map((id) => index.get(id))
      .filter((f): f is AgentColumnFinding => f != null);
    const agentIds = [...new Set(findings.map((f) => f.agent_id))];
    // Stable key from the group's sorted finding ids (server order already stable).
    return { key: g.finding_ids.join("|"), findings, agentIds };
  });
}

/** Agent findings that are not part of any multi-finding group, for the Tabs/detail view. */
export function ungroupedByColumn(columns: AgentColumn[]): Map<string, AgentColumnFinding[]> {
  return new Map(columns.map((c) => [c.run_id, c.findings]));
}
