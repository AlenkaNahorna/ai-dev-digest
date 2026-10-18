import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { CiRunRow } from "../model/types";
import { CiRunsView } from "./CiRunsView";

/**
 * CI Runs list (presentational). A populated list shows one row per run with the
 * PR, agent, verdict, findings count, cost, duration, and a link to the Actions
 * job; an empty list shows the empty state (AC-19). Props in → observable UI
 * out; no data hooks, navigation, or fetch mocked (client/INSIGHTS 2026-10-11).
 */

afterEach(cleanup);

const run = (over: Partial<CiRunRow> & { id: string }): CiRunRow =>
  ({
    ci_installation_id: "inst-1",
    repo: null,
    pr_number: null,
    ran_at: "2026-10-18T09:00:00Z",
    status: null,
    verdict: "comment",
    findings_count: 0,
    critical: null,
    warning: null,
    suggestion: null,
    cost_usd: null,
    github_url: null,
    source: "gha",
    agent: null,
    commit_sha: null,
    run_id: null,
    run_attempt: null,
    duration_s: null,
    ...over,
  }) as CiRunRow;

describe("CiRunsView", () => {
  it("renders one row per run with verdict, findings, PR, agent and an Actions-job link", () => {
    const runs: CiRunRow[] = [
      run({
        id: "r1",
        repo: "acme/widgets",
        pr_number: 42,
        agent: "Security Reviewer",
        verdict: "request_changes",
        findings_count: 3,
        cost_usd: 0.012,
        duration_s: 12.3,
        github_url: "https://github.com/acme/widgets/actions/runs/555",
      }),
      run({ id: "r2", pr_number: 7, agent: "Style Bot", verdict: "approve", findings_count: 0 }),
    ];
    render(<CiRunsView runs={runs} isLoading={false} isError={false} onRetry={() => {}} />);

    const rows = screen.getAllByRole("row").filter((r) => within(r).queryByText(/#\d+/));
    expect(rows).toHaveLength(2);

    const first = rows[0]!;
    // Repository column shows the run's installation repo (AC-19).
    expect(within(first).getByText("acme/widgets")).toBeInTheDocument();
    expect(within(first).getByText("#42")).toBeInTheDocument();
    expect(within(first).getByText("Security Reviewer")).toBeInTheDocument();
    expect(within(first).getByText("Changes requested")).toBeInTheDocument();
    expect(within(first).getByText("3")).toBeInTheDocument();
    // The Actions job link points at the GitHub run and opens in a new tab.
    const link = within(first).getByRole("link", { name: /Open the Actions job for run r1/i });
    expect(link).toHaveAttribute("href", "https://github.com/acme/widgets/actions/runs/555");

    // Second row has no Actions link (no github_url) and shows its own verdict.
    expect(within(rows[1]!).getByText("Passed")).toBeInTheDocument();
    expect(within(rows[1]!).queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no runs (AC-19)", () => {
    render(<CiRunsView runs={[]} isLoading={false} isError={false} onRetry={() => {}} />);
    expect(screen.getByText("No CI runs yet")).toBeInTheDocument();
    expect(screen.queryByRole("row")).not.toBeInTheDocument();
  });
});
