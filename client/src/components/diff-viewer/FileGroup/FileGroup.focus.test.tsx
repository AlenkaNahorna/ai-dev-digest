import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import prReview from "../../../../messages/en/prReview.json";
import { FileGroup } from "./FileGroup";

afterEach(cleanup);

const ui = (forceOpen?: boolean) => (
  <NextIntlClientProvider locale="en" messages={{ prReview }}>
    <FileGroup role="docs" label="Docs" hint="skim" color="red" fileCount={1} findingCount={0} defaultOpen={false} forceOpen={forceOpen}>
      <div>child</div>
    </FileGroup>
  </NextIntlClientProvider>
);

describe("FileGroup forceOpen (a collapsed group must not hide the file to reveal)", () => {
  it("starts open when it already holds the focused file", () => {
    render(ui(true));
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
    expect(screen.getByText("child")).toBeInTheDocument();
  });

  it("opens when the focus arrives later, and the user can still collapse it afterwards", () => {
    const { rerender } = render(ui(false));
    expect(screen.queryByText("child")).not.toBeInTheDocument();
    rerender(ui(true));
    expect(screen.getByText("child")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByText("child")).not.toBeInTheDocument();
  });
});
