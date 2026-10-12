import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SHA } from "../model/test-fixtures";
import { ShareDialog } from "./ShareDialog";

const TOUR = "22222222-2222-4222-8222-222222222222";
const REPO = "11111111-1111-4111-8111-111111111111";
const TOKEN = "T".repeat(43);

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let shares: Array<Record<string, unknown>>;
const realFetch = globalThis.fetch;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  calls = [];
  shares = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/onboarding-tour/shares") && method === "POST") {
      const s = { share_id: "33333333-3333-4333-8333-333333333333", tour_id: TOUR, source_sha: SHA, created_at: "2026-10-11T12:00:00.000Z", revoked_at: null, created_by_me: true };
      shares.push(s);
      return json({ share_id: s.share_id, tour_id: TOUR, url: `https://app.example.com/share/onboarding/${TOKEN}`, local_only: false, created_at: s.created_at }, 201);
    }
    if (url.endsWith("/onboarding-tour/shares")) return json({ shares });
    if (method === "DELETE") {
      shares = shares.map((s) => ({ ...s, revoked_at: "2026-10-11T13:00:00.000Z" }));
      return json({ share_id: "33333333-3333-4333-8333-333333333333", revoked_at: "2026-10-11T13:00:00.000Z" });
    }
    return json({}, 404);
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

function open(over: Partial<React.ComponentProps<typeof ShareDialog>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <ShareDialog repoId={REPO} tourId={TOUR} sourceSha={SHA} publicOriginConfigured onClose={onClose} {...over} />
    </QueryClientProvider>,
  );
  return onClose;
}

describe("ShareDialog", () => {
  it("states what becomes public before anything is created", async () => {
    open();
    expect(screen.getByText(/read-only public snapshot/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("No active links.")).toBeInTheDocument());
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("publishes the DISPLAYED version by id and shows the link once", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /Create public link/ }));
    await waitFor(() => expect(screen.getByTestId("share-url").textContent).toContain(`/share/onboarding/${TOKEN}`));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual({ tour_id: TOUR });
    expect(screen.getByText(/shown only once/)).toBeInTheDocument();
    // The active-links listing never contains the raw token.
    await waitFor(() => expect(screen.getByText(/Created /)).toBeInTheDocument());
    expect(document.body.textContent!.split(TOKEN).length - 1).toBe(1);
  });

  it("warns when links are local-only", async () => {
    open({ publicOriginConfigured: false });
    expect(screen.getByRole("note").textContent).toMatch(/only work on this machine/);
  });

  it("requires confirmation before revoking, then removes the link", async () => {
    shares = [{ share_id: "33333333-3333-4333-8333-333333333333", tour_id: TOUR, source_sha: SHA, created_at: "2026-10-11T12:00:00.000Z", revoked_at: null, created_by_me: true }];
    open();
    await waitFor(() => expect(screen.getByRole("button", { name: /Revoke/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Revoke/ }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Confirm revoke" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    await waitFor(() => expect(screen.getByText("No active links.")).toBeInTheDocument());
  });

  it("does not offer revoke for links created by someone else", async () => {
    shares = [{ share_id: "44444444-4444-4444-8444-444444444444", tour_id: TOUR, source_sha: SHA, created_at: "2026-10-11T12:00:00.000Z", revoked_at: null, created_by_me: false }];
    open();
    await waitFor(() => expect(screen.getByText("Created by another user")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Revoke/ })).toBeNull();
  });
});
