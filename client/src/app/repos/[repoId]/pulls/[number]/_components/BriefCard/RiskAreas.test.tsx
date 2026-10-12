import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Risk } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";
import { RiskAreas } from "./RiskAreas";

afterEach(cleanup);

const risk = (over: Partial<Risk>): Risk => ({
  kind: "compat",
  title: "Callers may break",
  explanation: "hidden until P3",
  severity: "high",
  file_refs: ["src/rate.ts", "src/server.ts"],
  ...over,
});

const renderRisks = (risks: Risk[]) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <RiskAreas risks={{ risks }} />
    </NextIntlClientProvider>,
  );

describe("RiskAreas", () => {
  it("lists every risk with its title, its files and a severity text that does not rely on color (AC-9, AC-10)", () => {
    renderRisks([
      risk({}),
      risk({ title: "Slow query", severity: "medium", file_refs: ["src/db.ts"] }),
      risk({ title: "Naming", severity: "low", file_refs: ["src/x.ts"] }),
    ]);
    const region = screen.getByRole("region", { name: "Risk areas" });
    const items = within(region).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("High severity");
    expect(items[0]).toHaveTextContent("Callers may break");
    expect(items[0]).toHaveTextContent("src/rate.ts");
    expect(items[0]).toHaveTextContent("src/server.ts");
    expect(items[1]).toHaveTextContent("Medium severity");
    expect(items[2]).toHaveTextContent("Low severity");
    // the explanation is stored but not shown before the P3 expand control
    expect(within(region).queryByText("hidden until P3")).not.toBeInTheDocument();
  });

  it("shows the empty message when the brief has no risks (AC-11)", () => {
    renderRisks([]);
    const region = screen.getByRole("region", { name: "Risk areas" });
    expect(within(region).getByText("No notable risks flagged.")).toBeInTheDocument();
    expect(within(region).queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("renders a hostile title as text (AC-14)", () => {
    const title = '<img src="https://evil.test/p.png"> <b>urgent</b>';
    const { container } = renderRisks([risk({ title })]);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(container.querySelector("img, b")).toBeNull();
  });
});
