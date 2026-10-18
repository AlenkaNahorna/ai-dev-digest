import { describe, it, expect } from "vitest";
import type { MultiAgentComparison } from "@devdigest/shared";
import { comparisonRows, formatRatio } from "./comparison";
import { latestReviewByAgent, oneLine } from "./prior-verdict";

const base: MultiAgentComparison = {
  agents_total: 3, agents_done: 3, tokens_in: 3000, tokens_out: 300, cost_usd: 0.05, cost_unknown_agents: 0,
  wall_clock_ms: 7000, sequential_sum_ms: 19000, baseline: null, shared_intent: null,
};

describe("comparisonRows (AC-48..52)", () => {
  it("produces no ratio without a baseline, and never assumes N×", () => {
    expect(comparisonRows(base).map((r) => r.ratio)).toEqual([null, null, null]);
  });

  it("computes the measured ratio against the baseline, whatever N is", () => {
    const rows = comparisonRows({
      ...base,
      baseline: { run_id: "r", agent_id: "a", agent_name: "A", tokens_in: 2000, tokens_out: 200, cost_usd: 0.04, duration_ms: 9000 },
    });
    expect(rows[0]!.ratio).toBeCloseTo(1.5);
    expect(rows[1]!.ratio).toBeCloseTo(1.25);
    expect(rows[2]!.ratio).toBeCloseTo(7000 / 9000); // below 1× is reported as measured
  });

  it("skips a metric whose baseline value is unknown or zero", () => {
    const rows = comparisonRows({
      ...base,
      baseline: { run_id: "r", agent_id: "a", agent_name: "A", tokens_in: null, tokens_out: null, cost_usd: null, duration_ms: 0 },
    });
    expect(rows.map((r) => r.ratio)).toEqual([null, null, null]);
  });
});

describe("formatRatio", () => {
  it("shows one decimal and a dash for unknown", () => {
    expect(formatRatio(1.94)).toBe("1.9×");
    expect(formatRatio(null)).toBe("—");
  });
});

describe("prior verdict helpers (AC-9)", () => {
  it("keeps the newest kind=review per agent and ignores others", () => {
    const mk = (id: string, agent: string, at: string, kind = "review") =>
      ({ id, agent_id: agent, kind, created_at: at }) as never;
    const m = latestReviewByAgent([
      mk("old", "a", "2026-01-01"), mk("new", "a", "2026-02-01"), mk("chat", "a", "2026-03-01", "chat"), mk("b1", "b", "2026-01-01"),
    ]);
    expect(m.get("a")!.id).toBe("new");
    expect(m.get("b")!.id).toBe("b1");
    expect(m.has("c")).toBe(false);
  });

  it("collapses whitespace to one line", () => {
    expect(oneLine("  a\n\n b\t c ")).toBe("a b c");
  });
});
