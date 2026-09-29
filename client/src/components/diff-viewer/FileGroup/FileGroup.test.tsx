import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import prReview from "../../../../messages/en/prReview.json";
import { FileGroup } from "./FileGroup";

afterEach(cleanup);

function ui(props: Partial<React.ComponentProps<typeof FileGroup>> = {}) {
  return (
    <NextIntlClientProvider locale="en" messages={{ prReview }}>
      <FileGroup role="docs" label="Docs" hint="skim" color="red" fileCount={3} findingCount={0} defaultOpen={false} {...props}>
        <div>child</div>
      </FileGroup>
    </NextIntlClientProvider>
  );
}

describe("FileGroup", () => {
  it("shows label + file count, is collapsed by default and expands on click", () => {
    render(ui());
    expect(screen.getByText("Docs")).toBeInTheDocument();
    expect(screen.getByText("3 files")).toBeInTheDocument();
    expect(screen.queryByText("child")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("child")).toBeInTheDocument();
  });

  it("shows the findings counter only when > 0", () => {
    const { unmount } = render(ui());
    expect(screen.queryByTestId("group-findings-docs")).not.toBeInTheDocument();
    unmount();
    render(ui({ findingCount: 2 }));
    expect(screen.getByTestId("group-findings-docs")).toHaveTextContent("2");
  });
});
