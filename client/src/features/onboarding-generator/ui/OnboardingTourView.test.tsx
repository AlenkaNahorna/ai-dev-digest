import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ApiError } from "@/lib/api";
import { stateFixture } from "../model/test-fixtures";
import { OnboardingTourView, type TourViewProps } from "./OnboardingTourView";

afterEach(cleanup);

function view(over: Partial<TourViewProps> = {}) {
  const props: TourViewProps = {
    repoName: "acme/payments-api",
    state: stateFixture(),
    isLoading: false,
    error: null,
    onRetry: vi.fn(),
    onRegenerate: vi.fn(),
    regenerating: false,
    regenerateError: null,
    onShare: vi.fn(),
    ...over,
  };
  render(<OnboardingTourView {...props} />);
  return props;
}

describe("OnboardingTourView", () => {
  it("shows the title, truthful provenance and both owner actions", () => {
    const p = view();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("payments-api");
    expect(screen.getByTestId("tour-subtitle").textContent).toMatch(/commit a1b2c3d/);
    fireEvent.click(screen.getByRole("button", { name: /Regenerate/ }));
    fireEvent.click(screen.getByRole("button", { name: /Share link/ }));
    expect(p.onRegenerate).toHaveBeenCalledTimes(1);
    expect(p.onShare).toHaveBeenCalledTimes(1);
  });

  it("disables owner actions for non-owners and explains why", () => {
    view({ state: stateFixture({ permissions: { can_regenerate: false, can_share: false, denied_reason: "not_owner" } }) });
    const regen = screen.getByRole("button", { name: /Regenerate/ }) as HTMLButtonElement;
    const share = screen.getByRole("button", { name: /Share link/ }) as HTMLButtonElement;
    expect(regen.disabled).toBe(true);
    expect(share.disabled).toBe(true);
    expect(regen.title).toMatch(/Only the repository owner/);
  });

  it("explains an unassigned owner", () => {
    view({ state: stateFixture({ permissions: { can_regenerate: false, can_share: false, denied_reason: "owner_unassigned" } }) });
    expect((screen.getByRole("button", { name: /Share link/ }) as HTMLButtonElement).title).toMatch(/no assigned owner/);
  });

  it("requires indexing first when there is no usable index", () => {
    view({ state: stateFixture({ availability: "index_required", tour: null, current_index: null }) });
    expect(screen.getByText("Index this repository first")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Regenerate|Share link/ })).toBeNull();
  });

  it("offers owner-only Generate when indexed but no tour exists", () => {
    const p = view({ state: stateFixture({ availability: "no_tour", tour: null }) });
    expect(screen.getByText("No tour yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate tour" }));
    expect(p.onRegenerate).toHaveBeenCalled();
  });

  it("hides Generate from non-owners", () => {
    view({ state: stateFixture({ availability: "no_tour", tour: null, permissions: { can_regenerate: false, can_share: false, denied_reason: "not_owner" } }) });
    expect(screen.queryByRole("button", { name: "Generate tour" })).toBeNull();
  });

  it("keeps the previous tour visible while regenerating, with a status banner", () => {
    view({ state: stateFixture({ generation: { status: "running", request_id: "r", trigger: "manual", requested_at: null, error_category: null, message: null } }) });
    expect(screen.getByRole("status").textContent).toMatch(/previous version stays visible/);
    expect(screen.getByRole("heading", { name: "Architecture overview" })).toBeInTheDocument();
    expect((screen.getByRole("button", { name: /Regenerate/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a failed attempt without hiding the last good tour", () => {
    view({ state: stateFixture({ generation: { status: "failed", request_id: "r", trigger: "manual", requested_at: null, error_category: "timeout", message: "The model took too long." } }) });
    expect(screen.getByRole("alert").textContent).toContain("The model took too long.");
    expect(screen.getByRole("heading", { name: "Critical paths" })).toBeInTheDocument();
  });

  it("flags a stale tour with both commits", () => {
    view({ state: stateFixture({ stale: true, current_index: { source_sha: "f".repeat(40), indexed_at: "2026-10-12T00:00:00.000Z", index_status: "full" } }) });
    expect(screen.getByRole("status").textContent).toMatch(/fffffff.*a1b2c3d/);
  });

  it("renders loading and error states", () => {
    cleanup();
    const p = view({ state: undefined, isLoading: true });
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    cleanup();
    view({ state: undefined, isLoading: false, error: new ApiError("boom", 500), onRetry: p.onRetry });
    expect(screen.getByText("Could not load the onboarding tour")).toBeInTheDocument();
  });
});
