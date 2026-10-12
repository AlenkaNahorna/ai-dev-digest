import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BlastRadius, PrBrief } from "@devdigest/shared";
import blastMessages from "../../../../../../../../messages/en/blast.json";
import briefMessages from "../../../../../../../../messages/en/brief.json";

const blastState = vi.hoisted(() => ({ value: undefined as unknown }));
const state = vi.hoisted(() => ({
  brief: {} as Record<string, unknown>,
  generate: {} as Record<string, unknown>,
}));

vi.mock("@/features/reviews/api/hooks", () => ({
  useBlastRadius: () => ({ data: blastState.value, isLoading: false, isError: false, refetch: vi.fn() }),
  usePrBrief: () => state.brief,
  useGenerateBrief: () => state.generate,
}));
vi.mock("@/lib/hooks/repo-intel", () => ({
  useResyncWithCompletion: () => ({ status: undefined, start: vi.fn(), resyncing: false, error: false, timedOut: false }),
}));
import { OverviewTab } from "./OverviewTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const blastData: BlastRadius = {
  changed_symbols: [{ name: "rateLimit", file: "src/rate.ts", kind: "function" }],
  downstream: [{ symbol: "rateLimit", callers: [{ name: "app", file: "src/server.ts", line: 88 }], endpoints_affected: [], crons_affected: [] }],
  summary: "",
};

const stored: PrBrief = {
  summary: "Adds a rate limiter.",
  risks: { risks: [{ kind: "compat", title: "Callers may break", explanation: "e", severity: "high", file_refs: ["src/rate.ts"] }] },
  review_focus: [{ file: "src/rate.ts", line: 12, reason: "New limiter logic" }],
  missing_inputs: [],
  partial: false,
};

blastState.value = blastData;

function renderTab(opts: { brief?: Record<string, unknown>; generate?: Record<string, unknown>; onOpenFile?: (f: string) => void } = {}) {
  state.brief = { data: null, isLoading: false, isError: false, refetch: vi.fn(), ...opts.brief };
  state.generate = { mutate: vi.fn(), isPending: false, isError: false, error: null, ...opts.generate };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={{ blast: blastMessages, brief: briefMessages }}>
        <OverviewTab prBody="PR text" prId="pr-1" repoId="repo-1" repoFullName="acme/payments" headSha="abc" intent={<div>INTENT CARD</div>} onOpenFile={opts.onOpenFile ?? vi.fn()} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("OverviewTab with the PR Brief", () => {
  it("orders the page: brief card, intent, risk areas, blast radius, review focus, description (AC-1, AC-29)", () => {
    renderTab({ brief: { data: stored } });
    const order = [
      screen.getByRole("region", { name: "PR Brief" }),
      screen.getByText("INTENT CARD"),
      screen.getByRole("region", { name: "Risk areas" }),
      screen.getByRole("region", { name: "Blast radius" }),
      screen.getByRole("region", { name: "Review focus — read these first" }),
      screen.getByText("PR text"),
    ];
    for (let i = 0; i < order.length - 1; i++) expect(follows(order[i]!, order[i + 1]!)).toBe(true);
    expect(screen.getByText("Adds a rate limiter.")).toBeInTheDocument();
  });

  it("shows only the card with Generate when no brief is stored: no risk or focus parts yet", () => {
    renderTab();
    expect(screen.getByText("Brief not available yet.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Risk areas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Review focus — read these first" })).not.toBeInTheDocument();
    expect(screen.getByText("INTENT CARD")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Blast radius" })).toBeInTheDocument();
  });

  it("starts a generation from the button and disables it while the mutation is pending (AC-3, AC-25)", () => {
    const mutate = vi.fn();
    renderTab({ generate: { mutate } });
    fireEvent.click(screen.getByRole("button", { name: "Generate brief" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    cleanup();
    renderTab({ generate: { mutate, isPending: true } });
    expect(screen.getByRole("button", { name: "Generating brief…" })).toBeDisabled();
  });

  it("keeps the stored brief and shows an alert when a regeneration fails (AC-5)", () => {
    renderTab({ brief: { data: stored }, generate: { isError: true, error: new Error("boom") } });
    expect(screen.getByText("Adds a rate limiter.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });

  it("shows a load error with retry and never 'no brief yet' when the stored brief cannot be read (AC-6)", () => {
    const refetch = vi.fn();
    renderTab({ brief: { data: undefined, isError: true, refetch } });
    expect(screen.queryByText("Brief not available yet.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("INTENT CARD")).toBeInTheDocument();
  });

  it("opens Files changed for the clicked Review focus item (AC-13)", () => {
    const onOpenFile = vi.fn();
    renderTab({ brief: { data: stored }, onOpenFile });
    fireEvent.click(screen.getByRole("button", { name: "Open src/rate.ts:12 in Files changed" }));
    expect(onOpenFile).toHaveBeenCalledWith("src/rate.ts");
  });

  it("contains a render error in the review focus part so the rest of the page keeps working", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderTab({ brief: { data: { ...stored, review_focus: null } } });
    expect(screen.getByText("Adds a rate limiter.")).toBeInTheDocument();
    expect(screen.getByText("INTENT CARD")).toBeInTheDocument();
    expect(screen.getByText("PR text")).toBeInTheDocument();
    expect(screen.getByText("Could not load the brief")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("contains a render error in the risk areas part so the rest of the page keeps working", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderTab({ brief: { data: { ...stored, risks: null } } });
    expect(screen.getByText("INTENT CARD")).toBeInTheDocument();
    expect(screen.getByText("PR text")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Blast radius" })).toBeInTheDocument();
    spy.mockRestore();
  });
});
