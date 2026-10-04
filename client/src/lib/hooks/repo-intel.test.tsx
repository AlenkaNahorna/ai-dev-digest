import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../api", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
import { api } from "../api";
import { useResyncWithCompletion } from "./repo-intel";

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

function setup(options: Parameters<typeof useResyncWithCompletion>[1] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useResyncWithCompletion("repo-1", options), { wrapper });
}

const index = (updatedAt: string) => ({ status: "partial", filesIndexed: 1, filesSkipped: 0, lastIndexedSha: "abc", updatedAt });

describe("useResyncWithCompletion", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it("reports done when the index updatedAt advances after the resync was accepted", async () => {
    let advanced = false;
    get.mockImplementation(async () => index(advanced ? "t2" : "t1"));
    post.mockImplementation(async () => {
      advanced = true;
      return { status: "accepted", jobId: "j1" };
    });
    const onSettled = vi.fn();
    const { result } = setup({ onSettled });
    await waitFor(() => expect(result.current.status).toBeDefined());

    act(() => result.current.start());
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith("done"));
    expect(onSettled).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.resyncing).toBe(false));
    expect(result.current.timedOut).toBe(false);
  });

  it("does not treat a late-loading index state as completion", async () => {
    let release: (v: ReturnType<typeof index>) => void = () => {};
    get.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    post.mockResolvedValue({ status: "accepted", jobId: "j1" });
    const onSettled = vi.fn();
    const { result } = setup({ onSettled, waitMs: 5000 });

    act(() => result.current.start());
    await waitFor(() => expect(result.current.resyncing).toBe(true));
    await act(async () => release(index("t1")));
    // The first state seen becomes the baseline; nothing has advanced yet.
    expect(onSettled).not.toHaveBeenCalled();
    expect(result.current.resyncing).toBe(true);
  });

  it("times out when the index never advances and says so", async () => {
    get.mockResolvedValue(index("t1"));
    post.mockResolvedValue({ status: "accepted", jobId: "j1" });
    const onSettled = vi.fn();
    const { result } = setup({ onSettled, waitMs: 40 });
    await waitFor(() => expect(result.current.status).toBeDefined());

    act(() => result.current.start());
    await waitFor(() => expect(result.current.timedOut).toBe(true));
    expect(onSettled).toHaveBeenCalledWith("timeout");
    expect(result.current.resyncing).toBe(false);
  });

  it("reports an error and does not wait when the API accepted but enqueued nothing", async () => {
    get.mockResolvedValue(index("t1"));
    post.mockResolvedValue({ status: "accepted", degraded: true, reason: "no_handler" });
    const { result } = setup();
    await waitFor(() => expect(result.current.status).toBeDefined());

    act(() => result.current.start());
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.resyncing).toBe(false);
  });
});
