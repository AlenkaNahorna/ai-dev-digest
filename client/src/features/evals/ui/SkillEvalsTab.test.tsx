import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "../../../../messages/en/eval.json";
import { SkillEvalsTab } from "./SkillEvalsTab";

afterEach(cleanup);

const exp = (kind: string) => ({ kind, file: "a.ts", start_line: 1, end_line: 2, title: "t", severity: "WARNING", category: "bug" });
const DATA = {
  passing: 1,
  with_runs: 1,
  cases: [
    {
      id: "c1", skill_id: "s1", name: "sql-injection", expectation: exp("must_find"), input_diff: "d", created_at: null,
      latest: { ran_at: "x", with_skill: { pass: true, summary: { emitted: 1, kept: 1, hits: 1, noise: 0, error: null } }, without_skill: { pass: false, summary: null } },
    },
    { id: "c2", skill_id: "s1", name: "leave-it", expectation: exp("must_not_flag"), input_diff: "d", created_at: null, latest: null },
  ],
};

vi.mock("@/lib/api", () => ({ api: { get: vi.fn(async () => DATA), post: vi.fn(), del: vi.fn(), patch: vi.fn() }, ApiError: class extends Error {} }));

describe("SkillEvalsTab", () => {
  it("shows badges, with/without percentages and row actions", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
          <SkillEvalsTab skillId="s1" skillName="sql" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("sql-injection")).toBeTruthy();
    expect(screen.getAllByTestId("eval-kind-badge").map((n) => n.textContent)).toEqual(["MUST FIND", "MUST NOT FLAG"]);
    expect(screen.getByText(/With skill 100% \/ Without skill 0%/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Run$/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /New eval case/ })).toBeTruthy();
  });
});
