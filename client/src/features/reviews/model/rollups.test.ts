import { describe, expect, it } from "vitest";
import { latestReviewsPerAgent } from "./rollups";

const review = (id: string, agent_id: string | null, created_at: string) => ({
  id, pr_id: "pr-1", agent_id, created_at, findings: [], agent_name: null, run_id: id, kind: "review" as const, score: null,
  verdict: null, summary: null, model: null,
});

describe("latestReviewsPerAgent", () => {
  it("keeps only the newest review per agent and preserves legacy reviews", () => {
    const result = latestReviewsPerAgent([
      review("new", "agent-1", "2026-01-02T00:00:00Z"),
      review("old", "agent-1", "2026-01-01T00:00:00Z"),
      review("legacy-a", null, "2026-01-01T00:00:00Z"),
      review("legacy-b", null, "2026-01-01T00:00:00Z"),
    ]);
    expect(result.map((item) => item.id)).toEqual(["new", "legacy-a", "legacy-b"]);
  });
});
