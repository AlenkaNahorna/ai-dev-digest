import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@devdigest/shared";
import prReview from "../../../../messages/en/prReview.json";
import shell from "../../../../messages/en/shell.json";
import { DiffViewer } from "./DiffViewer";

// Over AUTO_EXPAND_MAX_LINES (200): starts collapsed, so a focus click has to open it.
const big = (path: string, marker: string): PrFile => ({
  path, additions: 500, deletions: 0, patch: `@@ -1,2 +1,3 @@\n keep\n+${marker}\n end`,
});
const files = [big("src/one.ts", "ONE_BODY"), big("src/two.ts", "TWO_BODY")];

const scrolled: string[] = [];

beforeEach(() => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this.textContent ?? "");
  });
  // Run the frame callback synchronously so the assertions need no timers.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

const ui = (focusFile?: string | null) => (
  <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
    <DiffViewer files={files} focusFile={focusFile} />
  </NextIntlClientProvider>
);

describe("DiffViewer focusFile (Review focus deep link, AC-13)", () => {
  it("opens the focused file and scrolls it into view; other files stay collapsed", () => {
    render(ui("src/two.ts"));
    expect(screen.getByText("TWO_BODY")).toBeInTheDocument();
    expect(screen.queryByText("ONE_BODY")).not.toBeInTheDocument();
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]).toContain("src/two.ts");
  });

  it("does nothing for a path that is not in the diff: no scroll, nothing opened, no error", () => {
    render(ui("src/missing.ts"));
    expect(scrolled).toHaveLength(0);
    expect(screen.queryByText("ONE_BODY")).not.toBeInTheDocument();
    expect(screen.queryByText("TWO_BODY")).not.toBeInTheDocument();
  });

  it("scrolls once per change: a re-render with the same path does not scroll again, a new path does", () => {
    const { rerender } = render(ui("src/one.ts"));
    expect(scrolled).toHaveLength(1);
    rerender(ui("src/one.ts"));
    expect(scrolled).toHaveLength(1);
    rerender(ui("src/two.ts"));
    expect(scrolled).toHaveLength(2);
    expect(scrolled[1]).toContain("src/two.ts");
    expect(screen.getByText("TWO_BODY")).toBeInTheDocument();
  });

  it("lets the user collapse the focused file again", () => {
    render(ui("src/one.ts"));
    expect(screen.getByText("ONE_BODY")).toBeInTheDocument();
    fireEvent.click(screen.getByText("src/one.ts"));
    expect(screen.queryByText("ONE_BODY")).not.toBeInTheDocument();
  });

  it("works without a focusFile (default behaviour unchanged)", () => {
    render(ui(null));
    expect(scrolled).toHaveLength(0);
    expect(screen.getByText("src/one.ts")).toBeInTheDocument();
  });
});
