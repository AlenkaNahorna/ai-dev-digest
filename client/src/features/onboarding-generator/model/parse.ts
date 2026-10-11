import type {
  OnboardingTourContent,
  OnboardingTourState,
  PublicOnboardingSnapshot,
  TourProvenance,
} from "@devdigest/shared/contracts/onboarding-generator";
import { SECTION_ORDER } from "./view";

/**
 * Response-boundary guards. The client may import only TYPES from the vendored shared
 * package (a runtime import drags its barrel into webpack), so the structural checks the
 * UI relies on are enforced here: a drifted or hostile payload becomes a clear error
 * instead of a half-rendered page. The server remains the authority on full validation.
 */
export class UnexpectedResponseError extends Error {
  constructor(what: string) {
    super(`Unexpected ${what} response from the server.`);
    this.name = "UnexpectedResponseError";
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const SHA = /^[0-9a-f]{40}$/;
const AVAILABILITY = new Set(["index_required", "no_tour", "ready"]);
const GENERATION = new Set(["idle", "queued", "running", "failed", "budget_reached"]);

function validContent(c: unknown): c is OnboardingTourContent {
  if (!isObj(c) || !Array.isArray(c.sections) || c.sections.length !== SECTION_ORDER.length) return false;
  return c.sections.every(
    (s, i) =>
      isObj(s) &&
      s.key === SECTION_ORDER[i] &&
      (s.status === "unavailable" ? typeof s.reason === "string" : s.status === "available"),
  );
}

function validProvenance(p: unknown): p is TourProvenance {
  return (
    isObj(p) &&
    typeof p.source_sha === "string" &&
    SHA.test(p.source_sha) &&
    typeof p.indexed_at === "string" &&
    typeof p.generated_at === "string" &&
    (p.index_status === "full" || p.index_status === "partial") &&
    isObj(p.evidence)
  );
}

export function parseTourState(raw: unknown): OnboardingTourState {
  if (!isObj(raw) || !AVAILABILITY.has(String(raw.availability))) throw new UnexpectedResponseError("onboarding tour");
  if (!isObj(raw.generation) || !GENERATION.has(String(raw.generation.status))) throw new UnexpectedResponseError("onboarding tour");
  if (!isObj(raw.permissions) || typeof raw.permissions.can_regenerate !== "boolean" || typeof raw.permissions.can_share !== "boolean") {
    throw new UnexpectedResponseError("onboarding tour");
  }
  if (raw.tour !== null) {
    const t = raw.tour;
    if (!isObj(t) || typeof t.tour_id !== "string" || !validContent(t.content) || !validProvenance(t.provenance)) {
      throw new UnexpectedResponseError("onboarding tour");
    }
  }
  if (raw.availability === "ready" && raw.tour === null) throw new UnexpectedResponseError("onboarding tour");
  return raw as unknown as OnboardingTourState;
}

export function parsePublicSnapshot(raw: unknown): PublicOnboardingSnapshot {
  if (
    !isObj(raw) ||
    !isObj(raw.repository) ||
    typeof raw.repository.full_name !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw.repository.full_name) ||
    !validContent(raw.content) ||
    !validProvenance(raw.provenance) ||
    typeof raw.shared_at !== "string"
  ) {
    throw new UnexpectedResponseError("shared tour");
  }
  return raw as unknown as PublicOnboardingSnapshot;
}
