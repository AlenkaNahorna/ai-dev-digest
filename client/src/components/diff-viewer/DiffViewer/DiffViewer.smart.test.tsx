import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile } from "@devdigest/shared";
import prReview from "../../../../messages/en/prReview.json";
import shell from "../../../../messages/en/shell.json";
import { DiffViewer } from "./DiffViewer";
import type { DiffFindingApi } from "../findings";

afterEach(cleanup);

const file: PrFile = {
  path: "src/config.ts", additions: 1, deletions: 0,
  patch: '@@ -10,2 +10,3 @@\n port: 3000,\n+stripeKey: "x",\n redisUrl: x,',
};
const finding = (over: Partial<FindingRecord>): FindingRecord => ({
  id: "f1", severity: "CRITICAL", category: "security", title: "Hardcoded key", file: "src/config.ts",
  start_line: 11, end_line: 11, rationale: "Secret in source", suggestion: null, confidence: 0.9,
  kind: "finding", trifecta_components: null, evidence: null, review_id: "r1", accepted_at: null,
  dismissed_at: null, ...over,
}) as FindingRecord;

const api = (findings: FindingRecord[], showCards = true): DiffFindingApi => ({
  findings, showCards,
  renderFinding: (f) => <div data-testid="card">{f.title}: {f.rationale}</div>,
});

const renderIt = (fa: DiffFindingApi) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <DiffViewer files={[file]} findingApi={fa} />
    </NextIntlClientProvider>,
  );

describe("DiffViewer with findings", () => {
  it("shows the severity label, a file dot and the card under the anchored line", () => {
    renderIt(api([finding({})]));
    expect(screen.getByText("blocker")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Has findings" })).toBeInTheDocument();
    expect(screen.getByTestId("card")).toHaveTextContent("Hardcoded key: Secret in source");
  });

  it("hides cards but keeps stripe label when showCards is false", () => {
    renderIt(api([finding({})], false));
    expect(screen.getByText("blocker")).toBeInTheDocument();
    expect(screen.queryByTestId("card")).not.toBeInTheDocument();
  });

  it("renders a finding outside the patch in the unanchored block", () => {
    renderIt(api([finding({ id: "f2", start_line: 999, title: "Far away" })]));
    expect(screen.getByText("1 finding(s) outside the diff lines")).toBeInTheDocument();
    expect(within(screen.getByTestId("card")).getByText(/Far away/)).toBeInTheDocument();
    expect(screen.queryByText("blocker")).not.toBeInTheDocument();
  });
});
