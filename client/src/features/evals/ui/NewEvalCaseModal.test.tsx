import React from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseDraft } from "@devdigest/shared";
import messages from "../../../../messages/en/eval.json";

const create = vi.fn();
const tryRun = vi.fn();
vi.mock("../api/hooks", () => ({
  useCreateEvalCase: () => ({ mutate: create, isPending: false }),
  useTryEvalCase: () => ({ mutate: tryRun, isPending: false }),
  // The modal also wires the edit / manual / skill flows; these tests only drive the finding flow,
  // so those hooks are idle stubs (the modal reads just `mutate` and `isPending`).
  useUpdateEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateManualEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../api/skill-hooks", () => ({
  useCreateSkillEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useTrySkillCase: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { NewEvalCaseModal } from "./NewEvalCaseModal";

const DRAFT: EvalCaseDraft = {
  agent_id: "a1",
  agent_name: "Security Reviewer",
  provider: "openai",
  model: "gpt-x",
  name: "missing-authentication-in-api-calls",
  expectation: {
    kind: "must_find",
    file: "client/src/lib/api.ts",
    start_line: 9,
    end_line: 12,
    title: "Missing authentication in API calls",
    severity: "CRITICAL",
    category: "security",
  },
  input_diff: "--- a/client/src/lib/api.ts\n+++ b/client/src/lib/api.ts\n@@ -9 +9 @@\n-a\n+b\n",
  source_finding_id: "f1",
  source_pr_id: "pr1",
};

const renderModal = (onClose = () => {}) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <NewEvalCaseModal draft={DRAFT} onClose={onClose} />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  create.mockReset();
  tryRun.mockReset();
});
afterEach(cleanup);

describe("NewEvalCaseModal", () => {
  it("opens seeded: positive case, name, valid JSON, never run", () => {
    renderModal();
    expect(screen.getByTestId("eval-case-kind")).toHaveTextContent(/positive case/i);
    expect(screen.getByTestId("eval-case-kind")).toHaveTextContent("client/src/lib/api.ts:9-12");
    expect(screen.getByDisplayValue("missing-authentication-in-api-calls")).toBeInTheDocument();
    expect(screen.getByTestId("eval-json-status")).toHaveTextContent("valid JSON");
    expect(screen.getByTestId("eval-actual")).toHaveTextContent("Never run yet");
  });

  it("broken JSON disables Run case and Save; the skeleton button restores it", () => {
    renderModal();
    const json = screen.getByLabelText("Expected output");
    fireEvent.change(json, { target: { value: "{ nope" } });
    expect(screen.getByTestId("eval-json-status")).toHaveTextContent("not valid JSON");
    expect(screen.getByText("Run case").closest("button")).toBeDisabled();
    expect(screen.getByText("Save").closest("button")).toBeDisabled();
    fireEvent.click(screen.getByText("Finding skeleton"));
    expect(screen.getByTestId("eval-json-status")).toHaveTextContent("valid JSON");
    expect(screen.getByText("Run case").closest("button")).not.toBeDisabled();
  });

  it("Run case sends the edited expectation and diff without saving", () => {
    renderModal();
    fireEvent.click(screen.getByText("Run case"));
    expect(tryRun).toHaveBeenCalledTimes(1);
    expect(tryRun.mock.calls[0]![0]).toMatchObject({ expectation: { kind: "must_find", start_line: 9 }, input_diff: DRAFT.input_diff });
    expect(create).not.toHaveBeenCalled();
  });

  it("Save sends the user's edits for the finding", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "my case" } });
    fireEvent.click(screen.getByText("Save"));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toMatchObject({ findingId: "f1", overrides: { name: "my case", expectation: { file: "client/src/lib/api.ts" } } });
  });
});
