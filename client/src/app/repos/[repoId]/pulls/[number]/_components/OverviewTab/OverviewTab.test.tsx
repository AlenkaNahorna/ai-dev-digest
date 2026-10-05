import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BlastRadius } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/blast.json";

const blastState = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const resyncState = vi.hoisted(() => ({ value: {} as Record<string, unknown>, options: undefined as unknown }));

vi.mock("@/features/reviews/api/hooks", () => ({ useBlastRadius: () => blastState.value }));
vi.mock("@/lib/hooks/repo-intel", () => ({
  useResyncWithCompletion: (_repoId: string, options: unknown) => {
    resyncState.options = options;
    return resyncState.value;
  },
}));
import { OverviewTab } from "./OverviewTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const data: BlastRadius = {
  changed_symbols: [{ name: "rateLimit", file: "src/rate.ts", kind: "function" }],
  downstream: [{ symbol: "rateLimit", callers: [{ name: "app", file: "src/server.ts", line: 88 }], endpoints_affected: [], crons_affected: [] }],
  summary: "",
};

function renderTab(resync: Record<string, unknown>) {
  blastState.value = { data, isLoading: false, isError: false, refetch: vi.fn() };
  resyncState.value = { status: undefined, start: vi.fn(), resyncing: false, error: false, timedOut: false, ...resync };
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
        <OverviewTab prBody="PR text" prId="pr-1" repoId="repo-1" repoFullName="acme/payments" headSha="abc" intent={<div>INTENT CARD</div>} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { invalidate };
}

describe("OverviewTab", () => {
  it("renders the intent slot beside the blast radius, then the description", () => {
    renderTab({});
    expect(screen.getByText("INTENT CARD")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Blast radius" })).toBeInTheDocument();
    expect(screen.getByText("PR text")).toBeInTheDocument();
  });

  it("marks a partial index and starts the resync from the button", () => {
    const start = vi.fn();
    renderTab({ status: { status: "partial" }, start });
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("Index incomplete");
    fireEvent.click(within(notice).getByRole("button", { name: "Resync repo" }));
    expect(start).toHaveBeenCalledOnce();
  });

  it("shows the resync outcome: in progress, failed to start, and timed out", () => {
    renderTab({ status: { status: "partial" }, resyncing: true, error: true, timedOut: true });
    expect(screen.getByRole("button", { name: "Resyncing\u2026" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Resync could not be started/);
    expect(screen.getByText(/taking longer than expected/)).toBeInTheDocument();
  });

  it("contains a render error in the blast block so the rest of the page keeps working", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const refetch = vi.fn();
    renderTab({});
    // A malformed payload makes the card throw while rendering.
    blastState.value = { data: { changed_symbols: null, downstream: [], summary: "" }, isLoading: false, isError: false, refetch };
    cleanup();
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
          <OverviewTab prBody="PR text" prId="pr-1" repoId="repo-1" repoFullName="acme/payments" headSha="abc" intent={<div>INTENT CARD</div>} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Couldn't load blast radius")).toBeInTheDocument();
    expect(screen.getByText("INTENT CARD")).toBeInTheDocument();
    expect(screen.getByText("PR text")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("reloads the blast radius when the resync settles", () => {
    const { invalidate } = renderTab({});
    (resyncState.options as { onSettled: () => void }).onSettled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["pr-blast", "pr-1"] });
  });
});
