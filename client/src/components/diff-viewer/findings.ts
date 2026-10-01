/* Inline-finding support for the DiffViewer (Smart Diff). Pure helpers + the API
   shape the viewer needs. The FindingCard is injected by the route via a render
   prop so this shared component never imports route-private code. */
import type React from "react";
import type { FindingRecord, PrFile, SmartDiffRole } from "@devdigest/shared";
import type { Severity } from "@devdigest/ui";
import { lineKey } from "./comments";

export interface DiffFindingApi {
  /** Findings of the newest review per agent (all files). */
  findings: FindingRecord[];
  /** When false, cards are hidden; stripe + right label stay visible. */
  showCards: boolean;
  renderFinding: (f: FindingRecord) => React.ReactNode;
}

/** One rendered role group (Smart order). */
export interface DiffGroupView {
  role: SmartDiffRole;
  label: string;
  hint: string;
  files: PrFile[];
  /** Number of findings in this group. */
  findingCount: number;
  findingPaths: Set<string>;
  defaultOpen: boolean;
}

export type SeverityLabelKey = "blocker" | "warning" | "suggestion";

/** Findings only carry a new-side line, so they anchor on the RIGHT key. */
export function findingLineKey(f: Pick<FindingRecord, "start_line">): string | null {
  return lineKey("RIGHT", f.start_line);
}

/** Split a file's findings into ones anchored to a rendered line vs unanchored. */
export function partitionFindings(
  findings: FindingRecord[],
  renderedKeys: Set<string>,
): { matched: Map<string, FindingRecord[]>; unanchored: FindingRecord[] } {
  const matched = new Map<string, FindingRecord[]>();
  const unanchored: FindingRecord[] = [];
  for (const f of findings) {
    const key = findingLineKey(f);
    if (key && renderedKeys.has(key)) {
      const list = matched.get(key) ?? [];
      list.push(f);
      matched.set(key, list);
    } else {
      unanchored.push(f);
    }
  }
  return { matched, unanchored };
}

const RANK: Record<string, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };

/** Highest severity in the list (CRITICAL > WARNING > SUGGESTION). */
export function topSeverity(list: FindingRecord[]): Severity {
  let best: Severity = "SUGGESTION";
  let bestRank = -1;
  for (const f of list) {
    const r = RANK[f.severity] ?? 0;
    if (r > bestRank) {
      bestRank = r;
      best = (f.severity as Severity) ?? "SUGGESTION";
    }
  }
  return best;
}

/** Stripe label per severity; an unexpected severity falls back to "suggestion". */
export function severityLabelKey(sev: string): SeverityLabelKey {
  return sev === "CRITICAL" ? "blocker" : sev === "WARNING" ? "warning" : "suggestion";
}
