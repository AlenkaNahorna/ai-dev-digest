import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { content, provenance } from "../model/test-fixtures";
import { PublicTourScreen } from "./PublicTourScreen";

const TOKEN = "P".repeat(43);
const realFetch = globalThis.fetch;
let requested: string[];

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  requested = [];
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PublicTourScreen token={TOKEN} />
    </QueryClientProvider>,
  );
}

describe("PublicTourScreen", () => {
  it("renders only the public snapshot, with no private API calls", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response(
        JSON.stringify({ repository: { provider: "github", full_name: "acme/payments-api" }, content, provenance, shared_at: "2026-10-11T12:00:00.000Z" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    mount();
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("acme/payments-api"));
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain(`/public/onboarding/${TOKEN}`);
    expect(screen.queryByRole("button", { name: /Regenerate|Share link/ })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(5);
  });

  it("shows one generic message for invalid or revoked links", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { code: "not_found", message: "This link is not available." } }), { status: 404, headers: { "content-type": "application/json" } })) as typeof fetch;
    mount();
    await waitFor(() => expect(screen.getByText("This link is not available")).toBeInTheDocument());
  });
});
