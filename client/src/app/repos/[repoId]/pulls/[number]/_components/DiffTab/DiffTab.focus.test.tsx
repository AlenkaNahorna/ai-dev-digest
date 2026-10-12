import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, SmartDiffResponse } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";

const state: { smart: SmartDiffResponse | undefined } = { smart: undefined };

vi.mock("@/features/reviews/api/hooks", () => ({
  usePrComments: () => ({ data: [] }),
  useCreatePrComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
  usePrReviews: () => ({ data: [] }),
  useSmartDiff: () => ({ data: state.smart }),
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));

import { DiffTab } from "./DiffTab";

const scrolled: string[] = [];
beforeEach(() => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this.textContent ?? "");
  });
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

const PATCH = "@@ -10,2 +10,3 @@\n a\n+b\n c";
const files: PrFile[] = ["src/x.ts", "README.md"].map((path) => ({ path, additions: 1, deletions: 0, patch: PATCH }));
const sf = (path: string) => ({ path, additions: 1, deletions: 0, finding_lines: [] });
const smart: SmartDiffResponse = {
  groups: [
    { role: "core", files: [sf("src/x.ts")] },
    { role: "tests", files: [] },
    { role: "wiring", files: [] },
    { role: "docs", files: [sf("README.md")] },
    { role: "boilerplate", files: [] },
  ],
  split_suggestion: { too_big: false, total_lines: 2, proposed_splits: [] },
};

const renderTab = (focusFile?: string | null) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <DiffTab prId="pr" filesCount={2} files={files} canComment focusFile={focusFile} />
    </NextIntlClientProvider>,
  );

describe("DiffTab focusFile (Review focus deep link, AC-13)", () => {
  it("opens the collapsed Docs group and scrolls to the focused file inside it", () => {
    state.smart = smart;
    renderTab("README.md");
    expect(screen.getByRole("button", { name: /Docs/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]).toContain("README.md");
  });

  it("leaves the collapsed group closed and does not scroll when the path is not in the diff", () => {
    state.smart = smart;
    renderTab("nope/missing.ts");
    expect(screen.getByRole("button", { name: /Docs/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();
    expect(scrolled).toHaveLength(0);
  });

  it("also reaches the file in the flat list when smart order is not available", () => {
    state.smart = undefined;
    renderTab("README.md");
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]).toContain("README.md");
  });
});
