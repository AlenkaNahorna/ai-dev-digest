import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock the network boundary only. ApiError is kept real so the dialog's
// `instanceof ApiError` branch works.
vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
}));
// The CI tab pre-fills the repo from the active repo; stub it to a known value.
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/widgets" } }),
}));

import { api } from "@/lib/api";
import { CiTab } from "./CiTab";

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

/** The one-time ingest credential the server returns on first export. 64-hex. */
const ONE_TIME_CODE = Array.from({ length: 64 }, (_, i) => "0123456789abcdef"[i % 16]).join("");

const PREVIEW_FILES = [
  { path: ".devdigest/agents/security-reviewer.yaml", contents: "name: \"Security Reviewer\"\nskills: []\n", editable: true },
  { path: ".github/workflows/devdigest-review.yml", contents: "name: DevDigest Review\non:\n  pull_request:\n", editable: true },
];

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CiTab agentId="agent-1" />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe("CiTab", () => {
  it("lists installations, then runs the full Add-to-CI flow: preview files → confirm → token shown once", async () => {
    // Installations list for the tab.
    get.mockResolvedValue([
      { id: "inst-1", agent_id: "agent-1", repo: "acme/widgets", target_type: "gha", installed_at: "2026-10-18T09:00:00Z", latest_verdict: "approve", latest_ran_at: "2026-10-18T10:00:00Z" },
    ]);
    // First post = preview (action: files); second = export (action: open_pr).
    post
      .mockResolvedValueOnce({ installation: { id: "inst-1", agent_id: "agent-1", repo: "acme/widgets", target_type: "gha", installed_at: "2026-10-18T09:00:00Z" }, files: PREVIEW_FILES, pr_url: null })
      .mockResolvedValueOnce({ installation: { id: "inst-1", agent_id: "agent-1", repo: "acme/widgets", target_type: "gha", installed_at: "2026-10-18T09:00:00Z" }, files: PREVIEW_FILES, pr_url: "https://github.com/acme/widgets/pull/1", ingest_token: ONE_TIME_CODE });

    renderTab();

    // The existing installation renders in the tab.
    expect(await screen.findByText("acme/widgets")).toBeInTheDocument();

    // Open the single dialog.
    fireEvent.click(screen.getByRole("button", { name: /Add to CI/i }));
    const dialog = await screen.findByRole("dialog");
    // Repo is pre-filled from the active repo.
    expect(within(dialog).getByLabelText("Target repository")).toHaveValue("acme/widgets");

    // Preview the files (no PR yet) — the generated contents are shown.
    fireEvent.click(within(dialog).getByRole("button", { name: /Preview files/i }));
    expect(await within(dialog).findByText(".github/workflows/devdigest-review.yml")).toBeInTheDocument();
    expect(within(dialog).getByText(/Files preview \(2\)/)).toBeInTheDocument();
    // No secret VALUE is shown at preview time — only placeholder references.
    expect(within(dialog).queryByLabelText("Ingest token")).not.toBeInTheDocument();

    // Confirm & open the PR.
    fireEvent.click(within(dialog).getByRole("button", { name: /Confirm & open PR/i }));

    // The opened PR link and the one-time token appear after export.
    const prLink = await within(dialog).findByRole("link", { name: /github\.com\/acme\/widgets\/pull\/1/ });
    expect(prLink).toHaveAttribute("href", "https://github.com/acme/widgets/pull/1");
    const tokenBox = within(dialog).getByLabelText("Ingest token");
    expect(tokenBox).toHaveTextContent(ONE_TIME_CODE);
    expect(within(dialog).getByText(/SHOWN ONCE/i)).toBeInTheDocument();

    // The dialog lists the required secrets by NAME only (never a value).
    expect(within(dialog).getByText("OPENROUTER_API_KEY")).toBeInTheDocument();
    expect(within(dialog).getAllByText("DEVDIGEST_INGEST_TOKEN").length).toBeGreaterThan(0);

    // Two posts: the first a preview (action files), the second the export (open_pr).
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]![1]).toMatchObject({ repo: "acme/widgets", action: "files" });
    expect(post.mock.calls[1]![1]).toMatchObject({ repo: "acme/widgets", action: "open_pr" });
  });

  it("shows the empty state when the agent has no installations (AC-1)", async () => {
    get.mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText(/Not installed in any repository yet/i)).toBeInTheDocument();
  });
});
