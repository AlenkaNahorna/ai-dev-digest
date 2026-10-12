import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReviewFocusItem } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";
import { ReviewFocus } from "./ReviewFocus";

afterEach(cleanup);

const items: ReviewFocusItem[] = [
  { file: "src/rate.ts", line: 12, reason: "New limiter logic" },
  { file: "src/server.ts", line: null, reason: "Wiring changed" },
  { file: "README.md", reason: "No line given" },
];

function renderFocus(list: ReviewFocusItem[], onSelect = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <ReviewFocus items={list} onSelect={onSelect} />
    </NextIntlClientProvider>,
  );
  return onSelect;
}

describe("ReviewFocus", () => {
  it("shows file:line (or the file alone) with the reason, in the stored order (AC-12)", () => {
    renderFocus(items);
    const region = screen.getByRole("region", { name: "Review focus — read these first" });
    const buttons = within(region).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Open src/rate.ts:12 in Files changed",
      "Open src/server.ts in Files changed",
      "Open README.md in Files changed",
    ]);
    expect(buttons[0]).toHaveTextContent("src/rate.ts:12");
    expect(buttons[0]).toHaveTextContent("New limiter logic");
    expect(buttons[1]).toHaveTextContent("Wiring changed");
    expect(within(region).queryByText("src/server.ts:null")).not.toBeInTheDocument();
  });

  it("opens the clicked file, passing the path without the line (AC-13)", () => {
    const onSelect = renderFocus(items);
    fireEvent.click(screen.getByRole("button", { name: "Open src/rate.ts:12 in Files changed" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("src/rate.ts");
  });

  it("says there is no focus yet when the list is empty", () => {
    renderFocus([]);
    expect(screen.getByText("No focus yet")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a hostile reason as text (AC-14)", () => {
    const reason = '<script>alert(1)</script> [x](javascript:alert(1))';
    render(
      <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
        <ReviewFocus items={[{ file: "a.ts", line: 1, reason }]} onSelect={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(document.querySelector("script, a")).toBeNull();
  });
});
