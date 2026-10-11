export interface AttachedDoc {
  path: string;
  order: number;
}

/** An enabled agent→skill link with that skill's attached docs. */
export interface LinkedSkillDocs {
  /** Position of the skill in the agent's skill list (`agent_skills.order`). */
  skillOrder: number;
  docs: AttachedDoc[];
}

const byOrder = <T extends { order: number }>(a: T, b: T): number => a.order - b.order;

/**
 * The paths an agent run is grounded in: the agent's own docs in agent order,
 * then each enabled linked skill's docs (skill order, then doc order). Only the
 * first occurrence of a path is kept. Callers pass ONLY enabled links.
 */
export function effectiveSet(agentDocs: readonly AttachedDoc[], skills: readonly LinkedSkillDocs[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    out.push(path);
  };
  for (const d of [...agentDocs].sort(byOrder)) push(d.path);
  for (const s of [...skills].sort((a, b) => a.skillOrder - b.skillOrder)) {
    for (const d of [...s.docs].sort(byOrder)) push(d.path);
  }
  return out;
}

export interface UsageRow {
  agentId: string;
  path: string;
}

/** Distinct agents per document path, across direct attachments and skill-inherited ones. */
export function agentsPerPath(...sources: ReadonlyArray<readonly UsageRow[]>): Map<string, number> {
  const agents = new Map<string, Set<string>>();
  for (const rows of sources) {
    for (const r of rows) {
      let set = agents.get(r.path);
      if (!set) agents.set(r.path, (set = new Set()));
      set.add(r.agentId);
    }
  }
  return new Map([...agents].map(([path, set]) => [path, set.size]));
}
