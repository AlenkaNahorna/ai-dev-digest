import { LINE_TOLERANCE, TITLE_JACCARD_MIN } from './constants.js';

/**
 * Pure cross-agent finding grouping (AC-22..AC-28, D4). No DB/Fastify imports.
 *
 * Grouping is presentation-only: it returns groups as arrays of finding ids and
 * never mutates, merges or drops a finding. Two findings from DIFFERENT agents
 * belong to one group iff: same file AND line ranges overlap within
 * LINE_TOLERANCE AND (same category OR title-token Jaccard >= TITLE_JACCARD_MIN).
 * Two findings of the SAME agent are never grouped (AC-26). Deterministic and
 * stable: input order decides tie-breaks, so a fixed finding set yields fixed
 * groups (AC-28 prefers a lost merge over a wrong one).
 */

export type GroupingFinding = {
  id: string;
  agentId: string;
  file: string;
  startLine: number;
  endLine: number;
  category: string;
  title: string;
};

/** Lowercase, split on non-alphanumerics, drop empties → token set. */
function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((tok) => tok.length > 0),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const tok of a) if (b.has(tok)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Inclusive line-range overlap within ±tolerance. */
function linesOverlap(a: GroupingFinding, b: GroupingFinding): boolean {
  return a.startLine - LINE_TOLERANCE <= b.endLine && b.startLine - LINE_TOLERANCE <= a.endLine;
}

/** Whether two findings from different agents should collapse into one group. */
export function shouldGroup(a: GroupingFinding, b: GroupingFinding): boolean {
  if (a.agentId === b.agentId) return false; // AC-26
  if (a.file !== b.file) return false;
  if (!linesOverlap(a, b)) return false;
  if (a.category === b.category) return true;
  return jaccard(titleTokens(a.title), titleTokens(b.title)) >= TITLE_JACCARD_MIN;
}

/**
 * Compute groups as arrays of finding ids. Every finding appears in exactly one
 * group; a group of size 1 is an ungrouped finding. Order is deterministic:
 * groups follow first-seen input order, ids within a group follow input order.
 */
export function computeGroups(findings: GroupingFinding[]): { finding_ids: string[] }[] {
  // Union-find over indices, merging only pairs that pass shouldGroup. Because a
  // chain A~B~C can pull two findings of one agent into the same component, we
  // only union when the candidate's whole component shares no agent with the
  // other component — keeping the AC-26 invariant intact.
  const parent = findings.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const agentsOf = new Map<number, Set<string>>();
  findings.forEach((f, i) => agentsOf.set(i, new Set([f.agentId])));

  for (let i = 0; i < findings.length; i += 1) {
    for (let j = i + 1; j < findings.length; j += 1) {
      if (!shouldGroup(findings[i]!, findings[j]!)) continue;
      const ri = find(i);
      const rj = find(j);
      if (ri === rj) continue;
      const ai = agentsOf.get(ri)!;
      const aj = agentsOf.get(rj)!;
      // Never let a merge put two findings of one agent in a group (AC-26).
      let shares = false;
      for (const a of aj) if (ai.has(a)) { shares = true; break; }
      if (shares) continue;
      parent[rj] = ri;
      for (const a of aj) ai.add(a);
    }
  }

  const order: number[] = [];
  const members = new Map<number, string[]>();
  for (let i = 0; i < findings.length; i += 1) {
    const root = find(i);
    if (!members.has(root)) {
      members.set(root, []);
      order.push(root);
    }
    members.get(root)!.push(findings[i]!.id);
  }
  return order.map((root) => ({ finding_ids: members.get(root)! }));
}
