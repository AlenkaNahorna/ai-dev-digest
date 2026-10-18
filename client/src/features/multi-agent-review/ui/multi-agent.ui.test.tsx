import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { MultiAgentRun } from "@devdigest/shared";
import multiAgent from "../../../../messages/en/multiAgent.json";

// ---- module mocks (hooks + shell) so the screens render without a server ----
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer", () => ({ default: () => null }));
vi.mock("@/lib/api", () => ({ ApiError: class ApiError extends Error { code?: string } }));
vi.mock("@/lib/repo-context", () => ({ useActiveRepo: () => ({ repoId: "repo-1", reposLoaded: true }) }));

const AGENTS = [
  { id: "a-sec", name: "Security", model: "gpt-4.1", enabled: true },
  { id: "a-perf", name: "Performance", model: "gpt-4.1", enabled: true },
  { id: "a-old", name: "Archived", model: "gpt-4.1", enabled: false },
];
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: AGENTS, isLoading: false }) }));
vi.mock("@/features/pulls/api/hooks", () => ({
  usePulls: () => ({ data: [{ id: "pr-1", number: 482, title: "Add rate limiting" }], isLoading: false }),
}));

const REVIEWS = [
  {
    id: "rv1", pr_id: "pr-1", agent_id: "a-sec", run_id: "r1", kind: "review", verdict: "request_changes",
    // model output: must be shown as text, never parsed as markup
    summary: '<img src=x onerror="alert(1)"> Two critical exposures.', score: 38, model: "gpt-4.1",
    created_at: "2026-10-18T10:00:00.000Z", findings: [],
  },
];
vi.mock("@/features/reviews/api/hooks", () => ({
  usePrReviews: () => ({ data: REVIEWS, isLoading: false }),
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

const mutateAsync = vi.fn();
let RUN: MultiAgentRun | undefined;
vi.mock("../api/hooks", () => ({
  useMultiAgentEstimate: () => ({
    data: {
      estimates: [
        { agent_id: "a-sec", mean_duration_ms: 8200, mean_cost_usd: 0.06, sample_size: 3 },
        { agent_id: "a-perf", mean_duration_ms: null, mean_cost_usd: null, sample_size: 0 },
        { agent_id: "a-old", mean_duration_ms: null, mean_cost_usd: null, sample_size: 0 },
      ],
    },
    isFetching: false,
  }),
  useStartMultiAgentRun: () => ({ mutateAsync, isPending: false, isError: false, error: null, reset: vi.fn() }),
  useMultiAgentResults: () => ({ data: RUN, isLoading: false, isError: false }),
  useLatestMultiAgentRun: () => ({ data: { latest: null }, isLoading: false }),
}));

import { ConfigureRunScreen } from "./ConfigureRunScreen";
import { MultiAgentResultsScreen } from "./MultiAgentResultsScreen";
import { ConflictsBlock } from "./ConflictsBlock";
import { OneVsNBlock } from "./OneVsNBlock";

function intl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const finding = (id: string, agent: string, title: string, line = 52) => ({
  id, agent_id: agent, severity: "WARNING" as const, category: "bug", title, file: "src/middleware/ratelimit.ts",
  start_line: line, end_line: line, rationale: "because", suggestion: "do this", confidence: 0.81, state: "open" as const, kind: "finding",
});

const column = (over: Partial<MultiAgentRun["columns"][number]> & { run_id: string; agent_id: string; agent_name: string }) => ({
  provider: "openai", model: "gpt-4.1", status: "done" as const, verdict: "comment", score: 64, summary: "ok",
  duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.06, findings: [], ...over,
});

const baseComparison: MultiAgentRun["comparison"] = {
  agents_total: 3, agents_done: 2, tokens_in: 24000, tokens_out: 3000, cost_usd: 0.11, cost_unknown_agents: 1,
  wall_clock_ms: 8200, sequential_sum_ms: 15200, baseline: null, shared_intent: null,
};

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({ parent_id: "parent-9", runs: [] });
  RUN = {
    id: "parent-1", pr_id: "pr-1", pr_number: 482, ran_at: "2026-10-18T10:00:00.000Z", status: "partial", agent_count: 3,
    total_duration_ms: 8200, total_cost_usd: 0.11, comparison: baseComparison,
    columns: [
      column({ run_id: "r1", agent_id: "a-sec", agent_name: "Security", findings: [finding("f1", "a-sec", "Retry-After header omitted on 429")] }),
      column({ run_id: "r2", agent_id: "a-perf", agent_name: "Performance", status: "failed", score: null, cost_usd: null, findings: [] }),
      column({ run_id: "r3", agent_id: "a-cf", agent_name: "Customer-Facing", findings: [finding("f3", "a-cf", "Retry-After missing on 429 responses", 53)] }),
    ],
    groups: [{ finding_ids: ["f1", "f3"] }],
    conflicts: [],
  };
});
afterEach(cleanup);

describe("Configure run screen (AC-7..10)", () => {
  it("with no PR chosen shows the placeholder and a disabled run button (AC-7, AC-8)", () => {
    intl(<ConfigureRunScreen />);
    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run multi-agent review \(0\)/ })).toBeDisabled();
  });

  it("with a PR lists the agents with prior verdict + estimate, preselects enabled agents, and starts the run (AC-9, AC-10)", async () => {
    intl(<ConfigureRunScreen initialPrId="pr-1" />);

    // prior verdict line is plain text (the "<img ...>" is visible text, not an element)
    expect(screen.getByText(/Two critical exposures\./)).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    // an agent with no prior run says so explicitly; no fabricated estimate
    expect(screen.getAllByText("No prior run on this PR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("no estimate").length).toBeGreaterThan(0);
    expect(screen.getByText("8.2s · $0.06")).toBeInTheDocument();

    // enabled agents preselected, the disabled one is listed but cannot be selected
    expect(screen.getByRole("checkbox", { name: "Security" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "Archived" })).toBeDisabled();
    const run = screen.getByRole("button", { name: /Run multi-agent review \(2\)/ });
    expect(run).toBeEnabled();

    fireEvent.click(run);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(["a-sec", "a-perf"]));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/multi-agent?pr=pr-1&run=parent-9"));
  });

  it("per-agent checkboxes and Select all drive the count on the button (AC-10)", () => {
    intl(<ConfigureRunScreen initialPrId="pr-1" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Security" }));
    expect(screen.getByRole("button", { name: /Run multi-agent review \(1\)/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Performance" }));
    expect(screen.getByRole("button", { name: /Run multi-agent review \(0\)/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByRole("button", { name: /Run multi-agent review \(2\)/ })).toBeEnabled();
  });
});

describe("Results screen (AC-35..47)", () => {
  it("failure isolation: the failed column shows its state while the other agents still show their findings (AC-39)", () => {
    intl(<MultiAgentResultsScreen prId="pr-1" parentId="parent-1" />);
    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.getByText("Performance")).toBeInTheDocument();
    expect(screen.getByText(/This agent's run failed/)).toBeInTheDocument();
    // the other columns kept their results
    expect(screen.getAllByText("Retry-After header omitted on 429").length).toBeGreaterThan(0);
    // status is text, not only colour
    expect(screen.getAllByText("Failed").length).toBe(1);
    expect(screen.getAllByText("Done").length).toBe(2);
  });

  it("shows a status badge per agent that follows the run: queued → running (AC-36)", () => {
    RUN = {
      ...RUN!, status: "running",
      columns: [
        column({ run_id: "r1", agent_id: "a-sec", agent_name: "Security", status: "running", score: null, duration_ms: null, cost_usd: null, tokens_in: null, tokens_out: null }),
        column({ run_id: "r2", agent_id: "a-perf", agent_name: "Performance", status: "queued", score: null, duration_ms: null, cost_usd: null, tokens_in: null, tokens_out: null }),
      ],
      groups: [], comparison: { ...baseComparison, agents_total: 2, agents_done: 0 },
    };
    intl(<MultiAgentResultsScreen prId="pr-1" parentId="parent-1" />);
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("Waiting for a free slot…")).toBeInTheDocument();
    expect(screen.getByText(/Review in progress/)).toBeInTheDocument();
    // unknown numbers read "—", never 0
    expect(screen.getAllByText(/—/).length).toBeGreaterThan(0);
  });

  it("collapses the same finding from two agents into one group and keeps both originals and authors (AC-24, AC-25)", () => {
    intl(<MultiAgentResultsScreen prId="pr-1" parentId="parent-1" />);
    expect(screen.getByText("Flagged by 2 agents")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show original findings" }));
    expect(screen.getAllByText("Retry-After missing on 429 responses").length).toBeGreaterThan(1);
    expect(screen.getAllByText(/· Customer-Facing/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/· Security/).length).toBeGreaterThan(0);
  });

  it("Tabs mode shows the agent header card and expandable findings with 'also flagged by' (AC-41..43)", () => {
    intl(<MultiAgentResultsScreen prId="pr-1" parentId="parent-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Tabs" }));
    const finding = screen.getByRole("button", { name: /Retry-After header omitted on 429/ });
    expect(finding).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(finding);
    expect(finding).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Also flagged by Customer-Facing")).toBeInTheDocument();
    expect(screen.getByText("because")).toBeInTheDocument();
    expect(screen.getByText("do this")).toBeInTheDocument();
    // Learn / Turn into eval case stay disabled placeholders (AC-45); Reply to author is removed
    expect(screen.getByRole("button", { name: "Learn" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Reply to author" })).toBeNull();
  });

  it("includes the measured 1 vs N block and never states a 3x expectation (AC-51)", () => {
    intl(<MultiAgentResultsScreen prId="pr-1" parentId="parent-1" />);
    expect(screen.getByText(/1 vs N agents/)).toBeInTheDocument();
    expect(screen.getAllByText("no baseline").length).toBeGreaterThan(0);
    expect(screen.getByText(/Measured, not assumed/)).toBeInTheDocument();
    expect(screen.queryByText(/3×/)).toBeNull();
  });
});

describe("Where agents disagree (AC-32, AC-33, AC-57)", () => {
  const conflicts = [
    {
      file: "src/a.ts", line: 28, title: "Magic number 3600", is_conflict: true,
      takes: [
        { agent_id: "m", persona: "Junior Mentor", verdict: "SUGGESTION" as const, note: "Extract for readability." },
        // model-derived note containing markup: must render as inert text
        { agent_id: "s", persona: "Security", verdict: "ignored" as const, note: '<script>alert("x")</script> Not a security concern.' },
      ],
    },
    {
      file: "src/b.ts", line: 3, title: "Everyone agrees", is_conflict: false,
      takes: [{ agent_id: "m", persona: "Junior Mentor", verdict: "WARNING" as const, note: "n" }],
    },
  ];

  it("renders a note containing a script tag as plain text, never as HTML", () => {
    const { container } = intl(
      <ConflictsBlock conflicts={conflicts} showOnlyConflicts={false} onToggleShowOnly={() => {}} runIdForAgent={() => undefined} onViewTrace={() => {}} />,
    );
    expect(screen.getByText(/<script>alert\("x"\)<\/script> Not a security concern\./)).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });

  it("'Show only conflicts' hides the locations where every reviewing agent agreed", () => {
    const { rerender } = intl(
      <ConflictsBlock conflicts={conflicts} showOnlyConflicts={false} onToggleShowOnly={() => {}} runIdForAgent={() => undefined} onViewTrace={() => {}} />,
    );
    expect(screen.getByText("Everyone agrees")).toBeInTheDocument();
    expect(screen.getByText("Agreed")).toBeInTheDocument();
    rerender(
      <NextIntlClientProvider locale="en" messages={{ multiAgent }}>
        <ConflictsBlock conflicts={conflicts} showOnlyConflicts onToggleShowOnly={() => {}} runIdForAgent={() => undefined} onViewTrace={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText("Everyone agrees")).toBeNull();
    expect(screen.getByText("Magic number 3600")).toBeInTheDocument();
  });

  it("a run that did not complete reads 'no result', not 'did not flag' (AC-31)", () => {
    intl(
      <ConflictsBlock
        conflicts={[{ file: "a.ts", line: 1, title: "T", is_conflict: false, takes: [{ agent_id: "x", persona: "Slow", verdict: "no_result", note: "No result from Slow (run did not complete)" }] }]}
        showOnlyConflicts={false} onToggleShowOnly={() => {}} runIdForAgent={() => undefined} onViewTrace={() => {}}
      />,
    );
    expect(screen.getByText("no result (run did not complete)")).toBeInTheDocument();
    expect(screen.queryByText("did not flag")).toBeNull();
  });
});

describe("1 vs N block (AC-48..52)", () => {
  it("shows the measured ratio against a single-agent baseline without assuming N×", () => {
    const comparison: MultiAgentRun["comparison"] = {
      ...baseComparison, agents_total: 3, agents_done: 3, cost_unknown_agents: 0, tokens_in: 3000, tokens_out: 300, cost_usd: 0.05, wall_clock_ms: 7000,
      baseline: { run_id: "single", agent_id: "a-sec", agent_name: "Security", tokens_in: 1500, tokens_out: 150, cost_usd: 0.025, duration_ms: 6000 },
      shared_intent: { tokens_in: 300, tokens_out: 30, cost_usd: 0.001, cached: false },
    };
    intl(<OneVsNBlock comparison={comparison} status="done" />);
    expect(screen.getByText("Single-agent baseline (Security)")).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    // tokens 3,300 vs 1,650 → 2.0×; cost 0.05 vs 0.025 → 2.0×; time 7s vs 6s → 1.2×
    expect(within(rows.find((r) => within(r).queryByText("Tokens (in + out)"))!).getByText("2.0×")).toBeInTheDocument();
    expect(within(rows.find((r) => within(r).queryByText("Wall-clock"))!).getByText("1.2×")).toBeInTheDocument();
    expect(screen.getByText(/Shared intent call/)).toBeInTheDocument();
  });

  it("says 'no baseline' and shows no ratio when there is no prior single-agent run", () => {
    intl(<OneVsNBlock comparison={baseComparison} status="done" />);
    expect(screen.getAllByText("no baseline").length).toBe(3);
    expect(screen.queryByText(/\d\.\d×/)).toBeNull();
    // the unknown cost is excluded and reported, never counted as $0
    expect(screen.getByText(/1 agent has an unknown cost/)).toBeInTheDocument();
  });

  it("is a placeholder until an agent has finished", () => {
    intl(<OneVsNBlock comparison={{ ...baseComparison, agents_done: 0 }} status="running" />);
    expect(screen.getByText("Available once an agent has finished.")).toBeInTheDocument();
  });
});
