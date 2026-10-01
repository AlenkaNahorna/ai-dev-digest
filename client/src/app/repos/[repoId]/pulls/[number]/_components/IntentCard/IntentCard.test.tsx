import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrIntentRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { IntentCard } from "./IntentCard";

afterEach(cleanup);

function renderCard(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const intent: PrIntentRecord = {
  pr_id: "p1",
  summary: "Add rate limiting to public API endpoints",
  in_scope: ["Add middleware for rate limiting"],
  out_of_scope: ["Authentication changes"],
  confidence: "medium",
  sources: [
    { kind: "description", ref: "description", resolved: true },
    { kind: "spec", ref: "notion.so/team/spec", resolved: false },
  ],
  missing_context: ["Could not fetch spec: notion.so/team/spec"],
  stale: false,
  model: "deepseek/deepseek-v4-flash",
};

describe("IntentCard", () => {
  it("shows summary, scope lists, confidence, sources and missing context", () => {
    renderCard(<IntentCard intent={intent} onRederive={() => {}} />);
    expect(screen.getByText(/Add rate limiting to public API endpoints/)).toBeInTheDocument();
    expect(screen.getByText("Add middleware for rate limiting")).toBeInTheDocument();
    expect(screen.getByText("Authentication changes")).toBeInTheDocument();
    expect(screen.getByText("Medium confidence")).toBeInTheDocument();
    expect(screen.getByText(/notion\.so\/team\/spec \(unavailable\)/)).toBeInTheDocument();
    expect(screen.getByText("Could not fetch spec: notion.so/team/spec")).toBeInTheDocument();
  });

  it("flags a stale intent and re-derives on click", () => {
    const onRederive = vi.fn();
    renderCard(<IntentCard intent={{ ...intent, stale: true }} onRederive={onRederive} />);
    expect(screen.getByText("PR updated since this was derived")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Re-derive intent/ }));
    expect(onRederive).toHaveBeenCalledOnce();
  });

  it("offers to derive when nothing exists yet, and surfaces errors", () => {
    renderCard(<IntentCard intent={null} onRederive={() => {}} errorMessage="boom" />);
    expect(screen.getByRole("button", { name: /Derive intent/ })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });
});
