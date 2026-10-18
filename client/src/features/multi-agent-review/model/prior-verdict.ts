/* Pure helpers for the Configure run screen's per-agent "prior verdict" line (AC-9). */

import type { ReviewRecord } from "@devdigest/shared";

/** Newest review (kind='review') per agent for one PR; agents with none are absent. */
export function latestReviewByAgent(reviews: ReviewRecord[]): Map<string, ReviewRecord> {
  const byAgent = new Map<string, ReviewRecord>();
  for (const r of reviews) {
    if (r.kind !== "review" || !r.agent_id) continue;
    const prev = byAgent.get(r.agent_id);
    if (!prev || r.created_at > prev.created_at) byAgent.set(r.agent_id, r);
  }
  return byAgent;
}

/** Collapse whitespace so a multi-line model summary fits one line. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
