import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadius } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/blast.json";
import { BlastRadiusCard, type BlastRadiusCardProps } from "./BlastRadiusCard";

afterEach(cleanup);

const data: BlastRadius = {
  changed_symbols: [
    { name: "rateLimit", file: "src/rate.ts", kind: "function" },
    { name: "auth", file: "src/auth.ts", kind: "function" },
    { name: "lonely", file: "src/lonely.ts", kind: "function" },
  ],
  downstream: [
    {
      symbol: "rateLimit",
      callers: [{ name: "publicRouter", file: "src/routes/pub lic.ts", line: 23 }],
      endpoints_affected: ["GET /public"],
      crons_affected: ["nightly-sync"],
    },
    { symbol: "auth", callers: [{ name: "session", file: "src/session.ts", line: 5 }], endpoints_affected: [], crons_affected: [] },
  ],
  summary: "3 symbols · 2 callers · 1 endpoints · 1 crons",
  degraded: false,
};

function renderCard(over: Partial<BlastRadiusCardProps> = {}) {
  const props: BlastRadiusCardProps = {
    data,
    isLoading: false,
    isError: false,
    onRetry: () => {},
    repoFullName: "acme/payments",
    headSha: "abc123",
    ...over,
  };
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <BlastRadiusCard {...props} />
    </NextIntlClientProvider>,
  );
}

describe("BlastRadiusCard", () => {
  it("shows the four numbers computed from the rows", () => {
    renderCard();
    const region = screen.getByRole("region", { name: "Blast radius" });
    for (const [label, value] of [["symbols", "3"], ["callers", "2"], ["endpoints", "1"], ["cron/jobs", "1"]] as const) {
      expect(within(region).getByText(label).previousElementSibling).toHaveTextContent(value);
    }
  });

  it("links callers to the PR head on GitHub in a new tab", () => {
    renderCard();
    const link = screen.getByRole("link", { name: "src/routes/pub lic.ts:23" });
    expect(link).toHaveAttribute("href", "https://github.com/acme/payments/blob/abc123/src/routes/pub%20lic.ts#L23");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("expands the first symbol with callers, toggles others, and shows endpoint and cron chips", () => {
    renderCard();
    const first = screen.getByRole("button", { name: "Hide callers of rateLimit" });
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("GET /public")).toBeInTheDocument();
    expect(screen.getByText("nightly-sync")).toBeInTheDocument();

    const second = screen.getByRole("button", { name: "Show callers of auth" });
    expect(second).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("session")).not.toBeInTheDocument();
    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "src/session.ts:5" })).toBeInTheDocument();

    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("GET /public")).not.toBeInTheDocument();
  });

  it("renders a symbol without callers as a plain row with 0 callers", () => {
    renderCard();
    expect(screen.getByText("lonely")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /lonely/ })).not.toBeInTheDocument();
  });

  it("renders plain text locations when the repo is unknown", () => {
    renderCard({ repoFullName: null });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("src/routes/pub lic.ts:23")).toBeInTheDocument();
  });

  it("shows the degraded notice together with the data", () => {
    renderCard({ data: { ...data, degraded: true, degraded_reason: "no_data" } });
    expect(screen.getByRole("status")).toHaveTextContent(/No index data for these files yet/);
    expect(screen.getByText("rateLimit")).toBeInTheDocument();
  });

  it.each([
    ["flag_off", /indexing is turned off/],
    ["index_failed", /Indexing this repository failed/],
    ["index_partial", /index is incomplete/],
    ["repo_too_large", /too large to index/],
  ] as const)("shows distinct copy for %s", (reason, text) => {
    renderCard({ data: { ...data, degraded: true, degraded_reason: reason } });
    expect(screen.getByRole("status")).toHaveTextContent(text);
  });

  it("marks a partial index (reported by the index state, not by the blast data) and offers a resync", () => {
    const onResync = vi.fn();
    renderCard({ index: { status: "partial", onResync } });
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("Index incomplete");
    expect(notice).toHaveTextContent(/index is incomplete/);
    fireEvent.click(within(notice).getByRole("button", { name: "Resync repo" }));
    expect(onResync).toHaveBeenCalledOnce();
    expect(screen.getByText("rateLimit")).toBeInTheDocument();
  });

  it("disables the resync button while resyncing and reports a failed start", () => {
    renderCard({ index: { status: "failed", onResync: () => {}, resyncing: true, resyncError: true } });
    expect(screen.getByRole("button", { name: "Resyncing…" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/Indexing this repository failed/);
    expect(screen.getByRole("alert")).toHaveTextContent(/Resync could not be started/);
  });

  it("shows no mark for a full, non-degraded index", () => {
    renderCard({ index: { status: "full", onResync: () => {} } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("prefers the blast reason over the index status and hides resync when no handler is given", () => {
    renderCard({ data: { ...data, degraded: true, degraded_reason: "repo_too_large" }, index: { status: "partial" } });
    expect(screen.getByRole("status")).toHaveTextContent(/too large to index/);
    expect(screen.queryByRole("button", { name: "Resync repo" })).not.toBeInTheDocument();
  });

  it("switches between the tree and the graph view", () => {
    renderCard();
    const tree = screen.getByRole("button", { name: "tree" });
    const graph = screen.getByRole("button", { name: "graph" });
    expect(tree).toHaveAttribute("aria-pressed", "true");
    expect(graph).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("group", { name: "Blast radius graph" })).not.toBeInTheDocument();

    fireEvent.click(graph);
    expect(graph).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("group", { name: "Blast radius graph" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide callers of rateLimit" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /publicRouter/ })).toHaveAttribute("href", expect.stringContaining("github.com/acme/payments/blob/abc123/"));

    fireEvent.click(tree);
    expect(screen.queryByRole("group", { name: "Blast radius graph" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide callers of rateLimit" })).toBeInTheDocument();
  });

  it("explains an empty graph and hides the toggle when nothing changed", () => {
    renderCard({ data: { changed_symbols: [{ name: "a", file: "a.ts", kind: "function" }], downstream: [], summary: "" } });
    fireEvent.click(screen.getByRole("button", { name: "graph" }));
    expect(screen.getByText("No downstream callers to graph.")).toBeInTheDocument();
    cleanup();
    renderCard({ data: { changed_symbols: [], downstream: [], summary: "" } });
    expect(screen.queryByRole("button", { name: "graph" })).not.toBeInTheDocument();
  });

  it("lists same-named symbols from different files once, with a note, so callers are not repeated", () => {
    renderCard({
      data: {
        changed_symbols: [
          { name: "handler", file: "src/a.ts", kind: "function" },
          { name: "handler", file: "src/b.ts", kind: "function" },
        ],
        downstream: [{ symbol: "handler", callers: [{ name: "route", file: "src/r.ts", line: 4 }], endpoints_affected: [], crons_affected: [] }],
        summary: "",
      },
    });
    expect(screen.getAllByText("handler")).toHaveLength(1);
    expect(screen.getByText("+1 more file")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "src/r.ts:4" })).toHaveLength(1);
  });

  it("lists prior PRs that touched the same files with links to GitHub", () => {
    renderCard({
      data: {
        ...data,
        prior_prs: [
          { number: 41, title: "Tune limiter", status: "merged", shared_files: 2 },
          { number: 12, title: "Add auth", status: "open", shared_files: 1 },
        ],
      },
    });
    expect(screen.getByText("Prior PRs on these files")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#41" })).toHaveAttribute("href", "https://github.com/acme/payments/pull/41");
    expect(screen.getByText("Tune limiter")).toBeInTheDocument();
    expect(screen.getByText("2 shared files")).toBeInTheDocument();
    expect(screen.getByText("1 shared file")).toBeInTheDocument();
  });

  it("shows no prior PRs section when the response has none", () => {
    renderCard();
    expect(screen.queryByText("Prior PRs on these files")).not.toBeInTheDocument();
  });

  it("uses singular and plural caller labels", () => {
    renderCard();
    expect(screen.getAllByText("1 caller").length).toBeGreaterThan(0);
    expect(screen.queryByText("1 callers")).not.toBeInTheDocument();
  });

  it("shows the empty state for no changed symbols, but only the notice when degraded", () => {
    renderCard({ data: { changed_symbols: [], downstream: [], summary: "" } });
    expect(screen.getByText("No changed symbols were found in this PR.")).toBeInTheDocument();
    cleanup();
    renderCard({ data: { changed_symbols: [], downstream: [], summary: "", degraded: true, degraded_reason: "no_data" } });
    expect(screen.queryByText("No changed symbols were found in this PR.")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("says when changed symbols have no downstream callers", () => {
    renderCard({ data: { changed_symbols: [{ name: "a", file: "a.ts", kind: "function" }], downstream: [], summary: "" } });
    expect(screen.getByText("1 changed symbol(s), no downstream callers found.")).toBeInTheDocument();
  });

  it("shows an alert with retry on error", () => {
    const onRetry = vi.fn();
    renderCard({ data: undefined, isError: true, onRetry });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load blast radius");
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders no data and no alert while loading", () => {
    const { container } = renderCard({ data: undefined, isLoading: true });
    expect(container.querySelector(".skeleton")).not.toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Blast radius" })).not.toBeInTheDocument();
  });
});
