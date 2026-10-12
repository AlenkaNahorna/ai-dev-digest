import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SECTION_TITLES } from "../model/view";
import { SHA, content, provenance } from "../model/test-fixtures";
import { ArchitectureDiagram } from "./ArchitectureDiagram";
import { OnThisPage, TourSections } from "./TourSections";

afterEach(cleanup);

const renderSections = (repoFullName: string | null = "acme/payments-api") =>
  render(<TourSections content={content} provenance={provenance} repoFullName={repoFullName} />);

describe("TourSections", () => {
  it("renders the five cards in the fixed order", () => {
    renderSections();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(Object.values(SECTION_TITLES));
  });

  it("pins Open links to the stored commit and opens them safely", () => {
    renderSections();
    const link = screen.getAllByRole("link", { name: /Open src\/app\.ts/ })[0] as HTMLAnchorElement;
    expect(link.href).toBe(`https://github.com/acme/payments-api/blob/${SHA}/src/app.ts`);
    expect(link.rel).toContain("noopener");
    expect(link.target).toBe("_blank");
  });

  it("renders no Open link when the repository is unknown", () => {
    renderSections(null);
    expect(screen.queryAllByRole("link", { name: /^Open / })).toHaveLength(0);
  });

  it("orders setup steps and copies the exact command with feedback", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderSections();
    const section = document.getElementById("onboarding-local-run")!;
    const commands = within(section).getAllByText(/^pnpm /).map((e) => e.textContent);
    expect(commands).toEqual(["pnpm install", "pnpm dev"]);
    fireEvent.click(within(section).getAllByRole("button", { name: /Copy/ })[0]!);
    await waitFor(() => expect(within(section).getByText("Copied")).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith("pnpm install");
  });

  it("reports a failed copy instead of failing silently", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => { throw new Error("denied"); } },
      configurable: true,
    });
    renderSections();
    const section = document.getElementById("onboarding-local-run")!;
    fireEvent.click(within(section).getAllByRole("button", { name: /Copy/ })[0]!);
    await waitFor(() => expect(within(section).getByText("Copy failed")).toBeInTheDocument());
  });

  it("collapses and expands a card", () => {
    renderSections();
    const toggle = screen.getByRole("button", { name: /Critical paths/ });
    expect(screen.getByText("Entry point")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Entry point")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText("Entry point")).toBeInTheDocument();
  });

  it("shows an explicit reason for an unavailable section", () => {
    renderSections();
    const section = document.getElementById("onboarding-first-tasks")!;
    expect(within(section).getByText(/Not available\./)).toBeInTheDocument();
    expect(within(section).getByText(/no code evidence/)).toBeInTheDocument();
  });

  it("keeps javascript: links in model markdown inert", () => {
    renderSections();
    const section = document.getElementById("onboarding-architecture")!;
    const hrefs = Array.from(section.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://example.com");
    expect(hrefs.some((h) => h?.startsWith("javascript:"))).toBe(false);
  });
});

describe("ArchitectureDiagram", () => {
  it("renders model labels as text, never as markup", () => {
    const arch = content.sections[0];
    if (arch.status !== "available" || !arch.diagram) throw new Error("fixture");
    const { container } = render(<ArchitectureDiagram diagram={arch.diagram} />);
    const svg = container.querySelector("svg")!;
    expect(svg.querySelector("img")).toBeNull();
    expect(svg.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(svg.getAttribute("role")).toBe("img");
    expect(screen.getByText("View diagram as text")).toBeInTheDocument();
  });
});

describe("OnThisPage", () => {
  it("links to every section anchor", () => {
    render(<OnThisPage keys={["architecture", "first_tasks"]} />);
    expect(screen.getByRole("link", { name: "Architecture overview" }).getAttribute("href")).toBe("#onboarding-architecture");
    expect(screen.getByRole("link", { name: "First tasks" }).getAttribute("href")).toBe("#onboarding-first-tasks");
  });
});
