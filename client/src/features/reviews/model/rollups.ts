import type { ReviewRecord } from "@devdigest/shared";

/** Current review state for the PR list: newest review for each agent only. */
export function latestReviewsPerAgent(reviews: ReviewRecord[]): ReviewRecord[] {
  const latest = new Map<string, ReviewRecord>();
  for (const review of reviews) {
    const agentKey = review.agent_id ?? `review:${review.id}`;
    const previous = latest.get(agentKey);
    if (!previous || Date.parse(review.created_at) > Date.parse(previous.created_at)) latest.set(agentKey, review);
  }
  return [...latest.values()];
}
