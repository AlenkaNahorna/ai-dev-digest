import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseList, EvalCaseRecord } from "@devdigest/shared";
import messages from "../../../../messages/en/eval.json";
import { EvalCasesList } from "./EvalCasesList";

afterEach(cleanup);

const base = (over: Partial<EvalCaseRecord> & { id: string; name: string }): EvalCaseRecord => ({
  agent_id: "a1",
  expectation: { kind: "must_find", file: "src/js/filter.js", start_line: 30, end_line: 34, title: "t", severity: "WARNING", category: "bug" },
  input_diff: "diff",
  source_finding_id: "f",
  source_pr_id: "p",
  created_at: null,
  latest: null,
  ...over,
});

const LIST: EvalCaseList = {
  passing: 1,
  with_runs: 1,
  cases: [
    base({
      id: "c1",
      name: "find-me",
      latest: { pass: true, ran_at: "2026-10-16T10:00:00Z", batch_id: null, summary: { emitted: 2, kept: 1, hits: 1, noise: 0, error: null } },
    }),
    base({ id: "c2", name: "leave-it", expectation: { kind: "must_not_flag", file: "a.ts", start_line: 5, end_line: 5, title: "t", severity: "SUGGESTION", category: "style" } }),
  ],
};

const renderList = (props: Partial<React.ComponentProps<typeof EvalCasesList>> = {}) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalCasesList list={LIST} {...props} />
    </NextIntlClientProvider>,
  );

describe("EvalCasesList", () => {
  it("labels each case MUST FIND / MUST NOT FLAG", () => {
    renderList();
    const rows = screen.getAllByTestId("eval-case");
    expect(within(rows[0]!).getByTestId("eval-kind-badge")).toHaveTextContent("MUST FIND");
    expect(within(rows[1]!).getByTestId("eval-kind-badge")).toHaveTextContent("MUST NOT FLAG");
  });

  it("shows the latest result counts or 'never run'", () => {
    renderList();
    const rows = screen.getAllByTestId("eval-case");
    expect(rows[0]).toHaveTextContent("got 1 kept · 1 on target · 0 noise");
    expect(rows[1]).toHaveTextContent("never run");
  });

  it("Run / Edit / Delete act on their own row", () => {
    const onRun = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    renderList({ onRun, onEdit, onDelete });
    const second = screen.getAllByTestId("eval-case")[1]!;
    fireEvent.click(within(second).getByText("Run"));
    fireEvent.click(within(second).getByText("Edit"));
    fireEvent.click(within(second).getByLabelText("Delete case"));
    expect(onRun).toHaveBeenCalledWith("c2");
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "c2" }));
    expect(onDelete).toHaveBeenCalledWith("c2");
  });

  it("disables Run only on the row that is running", () => {
    renderList({ onRun: () => {}, runningId: "c1" });
    const rows = screen.getAllByTestId("eval-case");
    expect(within(rows[0]!).getByText("Running…").closest("button")).toBeDisabled();
    expect(within(rows[1]!).getByText("Run").closest("button")).not.toBeDisabled();
  });
});
