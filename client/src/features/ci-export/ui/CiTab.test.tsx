import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock the network boundary only. ApiError is kept real so the wizard's
// `instanceof ApiError` branch works.
vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
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
const put = vi.mocked(api.put);

/** The one-time ingest credential the server returns on first export. 64-hex. */
const ONE_TIME_CODE = Array.from({ length: 64 }, (_, i) => "0123456789abcdef"[i % 16]).join("");

const WORKFLOW = ".github/workflows/devdigest-review.yml";
const FILES = [
  { path: ".devdigest/agents/security-reviewer.yaml", contents: 'name: "Security Reviewer"\nskills: []\n', editable: false },
  { path: ".devdigest/memory.jsonl", contents: "\n", editable: false },
  { path: ".devdigest/runner/index.js", contents: "// bundled runner\n", editable: false },
  { path: WORKFLOW, contents: "name: DevDigest Review\non:\n  pull_request:\n", editable: true },
];

const INSTALLATION = {
  id: "inst-1",
  agent_id: "agent-1",
  repo: "acme/widgets",
  target_type: "gha",
  installed_at: "2026-10-18T09:00:00Z",
  latest_verdict: "approve",
  latest_ran_at: "2026-10-18T10:00:00Z",
  workflow_version: 1,
  latest_workflow_version: 2,
  post_as: "github_review",
  triggers: ["opened", "synchronize"],
  pr_url: "https://github.com/acme/widgets/pull/1",
};

const AGENT = { id: "agent-1", name: "Security Reviewer", ci_fail_on: "critical" };

function routeGets(over: { installations?: unknown; runs?: unknown } = {}) {
  get.mockImplementation(async (url: string) => {
    if (url.endsWith("/ci-installations")) return over.installations ?? [INSTALLATION];
    if (url.endsWith("/ci-runs")) return over.runs ?? [];
    if (url === "/agents/agent-1") return AGENT;
    throw new Error(`unexpected GET ${url}`);
  });
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CiTab agentId="agent-1" />
    </QueryClientProvider>,
  );
}

const previewResponse = { installation: null, files: FILES, pr_url: null };

afterEach(cleanup);
beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
});

async function openWizard() {
  renderTab();
  await screen.findByText("acme/widgets");
  fireEvent.click(screen.getAllByRole("button", { name: /Add to CI/i })[0]!);
  return screen.findByRole("dialog");
}

describe("CiTab", () => {
  it("shows installations with workflow version, update-available flag and the Fail CI on gate", async () => {
    routeGets();
    renderTab();
    expect(await screen.findByText("acme/widgets")).toBeInTheDocument();
    expect(screen.getByText(/Active in 1 repo/)).toBeInTheDocument();
    expect(screen.getByText(/workflow v1 · v2 available/)).toBeInTheDocument();
    expect(screen.getByLabelText("Fail CI on")).toHaveValue("critical");
  });

  it("saves Fail CI on through the agent update endpoint", async () => {
    routeGets();
    put.mockResolvedValue({ ...AGENT, ci_fail_on: "warning" });
    renderTab();
    await screen.findByText("acme/widgets");
    fireEvent.change(await screen.findByLabelText("Fail CI on"), { target: { value: "warning" } });
    await waitFor(() => expect(put).toHaveBeenCalledWith("/agents/agent-1", { ci_fail_on: "warning" }));
  });

  it("renders the run history with an Actions job link", async () => {
    routeGets({
      runs: [
        { id: "r1", repo: "acme/widgets", pr_number: 7, verdict: "request_changes", findings_count: 2, ran_at: "2026-10-18T10:00:00Z", github_url: "https://github.com/acme/widgets/actions/runs/9" },
      ],
    });
    renderTab();
    const link = await screen.findByRole("link", { name: /Actions job/i });
    expect(link).toHaveAttribute("href", "https://github.com/acme/widgets/actions/runs/9");
  });

  it("shows the empty state when the agent has no installations (AC-1)", async () => {
    routeGets({ installations: [] });
    renderTab();
    expect(await screen.findByText(/Not installed in any repository yet/i)).toBeInTheDocument();
  });
});

describe("Export wizard", () => {
  it("walks Target → Preview → Configure → Install and opens a PR with the chosen config", async () => {
    routeGets();
    post
      .mockResolvedValueOnce(previewResponse) // Target → Preview
      .mockResolvedValueOnce(previewResponse) // reopened toggled
      .mockResolvedValueOnce(previewResponse) // post-as changed
      .mockResolvedValueOnce({
        installation: { ...INSTALLATION },
        files: FILES,
        pr_url: "https://github.com/acme/widgets/pull/2",
        ingest_token: ONE_TIME_CODE,
      });

    const dialog = await openWizard();

    // 1 · Target: only GitHub Actions is offered; the repo is pre-filled.
    expect(within(dialog).getByText("GitHub Actions")).toBeInTheDocument();
    for (const absent of ["CircleCI", "Jenkins", "Generic CLI"]) {
      expect(within(dialog).queryByText(absent)).not.toBeInTheDocument();
    }
    expect(within(dialog).getByLabelText("Target repository")).toHaveValue("acme/widgets");
    fireEvent.click(within(dialog).getByRole("button", { name: /Continue/i }));

    // 2 · Preview: manifest, memory, runner and the workflow are listed; no PR yet.
    expect(await within(dialog).findByText(".devdigest/memory.jsonl")).toBeInTheDocument();
    expect(within(dialog).getByText(".devdigest/agents/security-reviewer.yaml")).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![1]).toMatchObject({ repo: "acme/widgets", action: "files", target: "gha" });
    // Edit the workflow.
    fireEvent.click(within(dialog).getByRole("button", { name: WORKFLOW }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Edit$/ }));
    fireEvent.change(within(dialog).getByLabelText(`Edit ${WORKFLOW}`), { target: { value: "name: edited\n" } });
    expect(within(dialog).getByText("edited")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Continue/i }));

    // 3 · Configure: warns that changing options resets workflow edits.
    expect(await within(dialog).findByText(/Secrets expected/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/resets your edits/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText("pull_request reopened"));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]![1]).toMatchObject({
      action: "files",
      triggers: ["opened", "synchronize", "reopened"],
      overrides: {}, // the workflow edit was dropped with the regeneration
    });
    fireEvent.click(within(dialog).getByLabelText(/PR comment/));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(post.mock.calls[2]![1]).toMatchObject({ post_as: "pr_comment" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Continue/i }));

    // 4 · Install: open the PR.
    expect(await within(dialog).findByText(/Open a PR with these files/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Install$/ }));

    const prLink = await within(dialog).findByRole("link", { name: /github\.com\/acme\/widgets\/pull\/2/ });
    expect(prLink).toHaveAttribute("href", "https://github.com/acme/widgets/pull/2");
    expect(within(dialog).getByLabelText("Ingest token")).toHaveTextContent(ONE_TIME_CODE);
    expect(within(dialog).getByText(/SHOWN ONCE/i)).toBeInTheDocument();
    expect(post.mock.calls[3]![1]).toMatchObject({
      repo: "acme/widgets",
      action: "open_pr",
      post_as: "pr_comment",
      triggers: ["opened", "synchronize", "reopened"],
    });
  });

  it("downloads a zip instead of opening a PR when 'Copy files as a zip' is chosen", async () => {
    routeGets();
    post
      .mockResolvedValueOnce(previewResponse)
      .mockResolvedValueOnce({ installation: { ...INSTALLATION }, files: FILES, pr_url: null, ingest_token: ONE_TIME_CODE });
    const createObjectURL = vi.fn(() => "blob:zip");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const dialog = await openWizard();
    fireEvent.click(within(dialog).getByRole("button", { name: /Continue/i })); // → Preview
    await within(dialog).findByText(".devdigest/memory.jsonl");
    fireEvent.click(within(dialog).getByRole("button", { name: /Continue/i })); // → Configure
    fireEvent.click(within(dialog).getByRole("button", { name: /Continue/i })); // → Install
    fireEvent.click(within(dialog).getByRole("radio", { name: /Copy files as a zip/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Install$/ }));

    expect(await within(dialog).findByText(/Zip downloaded/i)).toBeInTheDocument();
    expect(post.mock.calls[1]![1]).toMatchObject({ action: "zip" });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalled();
    expect(within(dialog).getByLabelText("Ingest token")).toHaveTextContent(ONE_TIME_CODE);
    click.mockRestore();
  });

  it("blocks Continue until the repository is a valid owner/name", async () => {
    routeGets();
    const dialog = await openWizard();
    fireEvent.change(within(dialog).getByLabelText("Target repository"), { target: { value: "not a repo" } });
    expect(within(dialog).getByRole("button", { name: /Continue/i })).toBeDisabled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/owner\/name/);
  });
});
