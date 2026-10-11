import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBrief } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";
import { BriefBanner, type BriefBannerProps } from "./BriefBanner";

afterEach(cleanup);

const stored: PrBrief = {
  summary: "Adds a rate limiter to the public endpoints.",
  risks: { risks: [] },
  review_focus: [],
  missing_inputs: [],
  partial: false,
};

function renderBanner(over: Partial<BriefBannerProps> = {}) {
  const props: BriefBannerProps = {
    brief: null,
    isLoading: false,
    isLoadError: false,
    onRetryLoad: vi.fn(),
    onGenerate: vi.fn(),
    generating: false,
    generateError: null,
    ...over,
  };
  render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <BriefBanner {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

describe("BriefBanner", () => {
  it("offers Generate with the 'not available yet' message and starts one generation on click (AC-2, AC-3)", () => {
    const props = renderBanner();
    expect(screen.getByRole("region", { name: "PR Brief" })).toBeInTheDocument();
    expect(screen.getByText("Brief not available yet.")).toBeInTheDocument();
    expect(screen.getByText(/Press Generate brief/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate brief" }));
    expect(props.onGenerate).toHaveBeenCalledTimes(1);
  });

  it("shows neither Generate nor the empty message while the stored brief loads (AC-6)", () => {
    renderBanner({ brief: undefined, isLoading: true });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Brief not available yet.")).not.toBeInTheDocument();
  });

  it("shows a load error with retry instead of 'no brief yet' (AC-6)", () => {
    const props = renderBanner({ brief: undefined, isLoadError: true });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load the brief");
    expect(screen.queryByText("Brief not available yet.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(props.onRetryLoad).toHaveBeenCalledTimes(1);
  });

  it("disables Generate while the first generation runs (AC-3, AC-25)", () => {
    renderBanner({ generating: true });
    const button = screen.getByRole("button", { name: "Generating brief…" });
    expect(button).toBeDisabled();
    expect(screen.getByRole("region", { name: "PR Brief" })).toHaveAttribute("aria-busy", "true");
  });

  it("shows a failed generation as an alert with a retry action (AC-5)", () => {
    const props = renderBanner({ generateError: { message: "boom" } });
    expect(screen.getByRole("alert")).toHaveTextContent("The brief could not be generated: boom");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(props.onGenerate).toHaveBeenCalledTimes(1);
  });

  it("explains that file data is unavailable for the stable error code (AC-28a)", () => {
    renderBanner({ generateError: { message: "File data is unavailable for this pull request", code: "brief_files_unavailable" } });
    expect(screen.getByRole("alert")).toHaveTextContent("File data is unavailable for this pull request, so no brief can be written.");
  });

  it("shows the model failure once: the server text already says the brief could not be generated", () => {
    renderBanner({ generateError: { message: "The brief could not be generated", code: "brief_model_failed" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/^The brief could not be generated\. Try again\.$/);
  });

  it("falls back to a generic message when the error has no text", () => {
    renderBanner({ generateError: { message: "" } });
    expect(screen.getByRole("alert")).toHaveTextContent("The brief could not be generated. Try again.");
  });

  it("shows the stored summary with a refresh action that regenerates (AC-8, AC-23)", () => {
    const props = renderBanner({ brief: stored });
    expect(screen.getByText(stored.summary)).toBeInTheDocument();
    expect(screen.queryByText("Brief not available yet.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Built without/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh brief" }));
    expect(props.onGenerate).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous brief visible, marks it as updating and disables refresh while regenerating (AC-24, AC-25)", () => {
    renderBanner({ brief: stored, generating: true });
    expect(screen.getByText(stored.summary)).toBeInTheDocument();
    const region = screen.getByRole("region", { name: "PR Brief" });
    expect(within(region).getAllByText("Updating…").length).toBeGreaterThanOrEqual(2); // badge + button label
    expect(within(region).getByRole("button", { name: "Updating…" })).toBeDisabled();
  });

  it("keeps the stored brief visible when a regeneration fails (AC-5)", () => {
    renderBanner({ brief: stored, generateError: { message: "boom" } });
    expect(screen.getByText(stored.summary)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
    expect(screen.getByRole("button", { name: "Refresh brief" })).toBeEnabled();
  });

  it("names the inputs the brief was built without and says when it used partial data (AC-27, AC-35)", () => {
    renderBanner({ brief: { ...stored, missing_inputs: ["intent", "findings"], partial: true } });
    expect(screen.getByText(/Built without:/)).toHaveTextContent("Intent not derived yet · No review findings yet");
    expect(screen.getByText(/Built from partial data/)).toBeInTheDocument();
  });

  it("renders model text as plain text: no HTML, no Markdown, no remote content (AC-14)", () => {
    const hostile = '<script>window.__pwned = 1</script><img src="https://evil.test/p.png" onerror="alert(1)"> **bold** [link](https://evil.test)';
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
        <BriefBanner
          brief={{ ...stored, summary: hostile }}
          isLoading={false}
          isLoadError={false}
          onRetryLoad={vi.fn()}
          onGenerate={vi.fn()}
          generating={false}
          generateError={null}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(hostile)).toBeInTheDocument();
    expect(container.querySelector("script, img, strong, a")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});
