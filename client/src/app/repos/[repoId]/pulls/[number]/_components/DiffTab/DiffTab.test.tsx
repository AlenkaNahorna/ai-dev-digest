import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, ReviewRecord, SmartDiffResponse } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";

const mutate = vi.fn();
const state: { reviews: ReviewRecord[]; smart: SmartDiffResponse | undefined } = { reviews: [], smart: undefined };

vi.mock("@/features/reviews/api/hooks", () => ({
  usePrComments: () => ({ data: [] }),
  useCreatePrComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
  usePrReviews: () => ({ data: state.reviews }),
  useSmartDiff: () => ({ data: state.smart }),
  useFindingAction: () => ({ mutate, isPending: false, variables: undefined }),
}));

import { DiffTab } from "./DiffTab";

afterEach(() => { cleanup(); mutate.mockReset(); });

const PATCH = '@@ -10,2 +10,3 @@\n a\n+b\n c';
const files: PrFile[] = ["pnpm-lock.yaml", "src/x.ts", "src/x.test.ts", "src/index.ts", "README.md"].map((path) => ({
  path, additions: 1, deletions: 0, patch: PATCH,
}));
const sf = (path: string, finding_lines: number[] = []) => ({ path, additions: 1, deletions: 0, finding_lines });
const smart = (lines: number[]): SmartDiffResponse => ({
  groups: [
    { role: "core", files: [sf("src/x.ts", lines)] },
    { role: "tests", files: [sf("src/x.test.ts")] },
    { role: "wiring", files: [sf("src/index.ts")] },
    { role: "docs", files: [sf("README.md")] },
    { role: "boilerplate", files: [sf("pnpm-lock.yaml")] },
  ],
  split_suggestion: { too_big: false, total_lines: 5, proposed_splits: [] },
});
const finding: FindingRecord = {
  id: "f1", severity: "WARNING", category: "bug", title: "Magic number", file: "src/x.ts", start_line: 11,
  end_line: 11, rationale: "Explain it", suggestion: null, confidence: 0.6, kind: "finding",
  trifecta_components: null, evidence: null, review_id: "r1", accepted_at: null, dismissed_at: null,
};
const review = (findings: FindingRecord[] = [finding]): ReviewRecord => ({
  id: "r1", pr_id: "pr", agent_id: "a1", run_id: null, kind: "review", verdict: null, summary: null,
  score: null, model: null, created_at: "2026-01-01T00:00:00Z", findings,
}) as ReviewRecord;

const renderTab = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <DiffTab prId="pr" filesCount={5} files={files} canComment />
    </NextIntlClientProvider>,
  );

describe("DiffTab (Smart Diff)", () => {
  it("shows five groups in order with counts; docs/boilerplate collapsed and expandable", () => {
    state.reviews = []; state.smart = smart([]);
    renderTab();
    const headers = Array.from(document.querySelectorAll("[aria-expanded]"));
    expect(headers.map((h) => h.textContent)).toEqual([
      expect.stringContaining("Core logic"), expect.stringContaining("Tests"), expect.stringContaining("Wiring"),
      expect.stringContaining("Docs"), expect.stringContaining("Boilerplate"),
    ]);
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Boilerplate/ }));
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
  });

  it("shows every category with a zero-file count when the API omits empty groups", () => {
    state.reviews = [];
    state.smart = { ...smart([]), groups: [{ role: "core", files: [sf("src/x.ts")] }] };
    renderTab();
    expect(document.querySelectorAll("[data-role]")).toHaveLength(5);
    expect(screen.getAllByText("0 files")).toHaveLength(4);
  });

  it("after a review shows ● 1 on the group, a dot on the file, the finding under the line and wires Accept", () => {
    state.reviews = [review()]; state.smart = smart([11]);
    renderTab();
    expect(screen.getByTestId("group-findings-core")).toHaveTextContent("1");
    expect(screen.getByRole("img", { name: "Has findings" })).toBeInTheDocument();
    expect(screen.getByText("Magic number")).toBeInTheDocument();
    expect(screen.getByText("Explain it")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Accept/ }));
    expect(mutate).toHaveBeenCalledWith({ findingId: "f1", action: "accept", prId: "pr" }, expect.anything());
  });

  it("counts multiple findings in one file in the group badge", () => {
    state.reviews = [review([finding, { ...finding, id: "f2", title: "Another issue" }])];
    state.smart = smart([11]);
    renderTab();
    expect(screen.getByTestId("group-findings-core")).toHaveTextContent("2");
  });

  it("Original order removes group headers and keeps pr.files order", () => {
    state.reviews = []; state.smart = smart([]);
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Original order" }));
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
    const paths = screen.getAllByText(/^(pnpm-lock\.yaml|src\/x\.ts|src\/x\.test\.ts|src\/index\.ts|README\.md)$/).map((e) => e.textContent);
    expect(paths).toEqual(files.map((f) => f.path));
  });

  it("the shared toggle hides finding cards", () => {
    state.reviews = [review()]; state.smart = smart([11]);
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /Hide comments/ }));
    expect(screen.queryByText("Explain it")).not.toBeInTheDocument();
    expect(screen.getByText("warning")).toBeInTheDocument();
  });
});
