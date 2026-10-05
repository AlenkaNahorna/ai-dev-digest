import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "./error-boundary";

afterEach(cleanup);

function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new Error("boom");
  return <div>fine</div>;
}

function mute() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("ErrorBoundary", () => {
  it("renders the fallback instead of crashing the tree, and reports the error", () => {
    const spy = mute();
    const onError = vi.fn();
    render(
      <div>
        <span>rest of page</span>
        <ErrorBoundary fallback={(_r, e) => <div>fallback: {e.message}</div>} onError={onError}>
          <Bomb explode />
        </ErrorBoundary>
      </div>,
    );
    expect(screen.getByText("fallback: boom")).toBeInTheDocument();
    expect(screen.getByText("rest of page")).toBeInTheDocument();
    expect(onError).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("tries the children again after reset", () => {
    const spy = mute();
    let explode = true;
    const view = () => (
      <ErrorBoundary fallback={(reset) => <button onClick={reset}>retry</button>}>
        <Bomb explode={explode} />
      </ErrorBoundary>
    );
    const { rerender } = render(view());
    explode = false;
    fireEvent.click(screen.getByText("retry"));
    rerender(view());
    expect(screen.getByText("fine")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("resets itself when a reset key changes", () => {
    const spy = mute();
    const { rerender } = render(
      <ErrorBoundary fallback={() => <div>fallback</div>} resetKeys={[1]}>
        <Bomb explode />
      </ErrorBoundary>,
    );
    expect(screen.getByText("fallback")).toBeInTheDocument();
    rerender(
      <ErrorBoundary fallback={() => <div>fallback</div>} resetKeys={[2]}>
        <Bomb explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("fine")).toBeInTheDocument();
    spy.mockRestore();
  });
});
