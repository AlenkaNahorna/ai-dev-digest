import type {
  OnboardingTourContent,
  OnboardingTourState,
  TourProvenance,
} from "@devdigest/shared/contracts/onboarding-generator";

export const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

export const provenance: TourProvenance = {
  source_sha: SHA,
  indexed_at: "2026-10-11T10:00:00.000Z",
  indexer_version: 3,
  index_status: "full",
  generated_at: "2026-10-11T10:05:00.000Z",
  evidence: {
    documents_used: 4,
    documents_skipped: 0,
    excerpts_used: 3,
    ranked_files: 12,
    critical_chains: 2,
    symbols: 40,
    documents_excluded_for_secrets: 0,
    lines_redacted: 0,
    truncated: false,
    notes: [],
  },
  degraded_sections: [],
};

export const content: OnboardingTourContent = {
  sections: [
    {
      key: "architecture",
      status: "available",
      summary: "A Fastify API with a **database layer**. [safe](https://example.com) [bad](javascript:alert(1))",
      diagram: {
        nodes: [
          { id: "app", label: "App <img src=x onerror=alert(1)>", kind: "service", path: "src/app.ts" },
          { id: "routes", label: "Routes", kind: "module", path: "src/routes.ts" },
          { id: "db", label: "DB", kind: "datastore", path: null },
        ],
        edges: [
          { from: "app", to: "routes", label: null },
          { from: "routes", to: "db", label: "queries" },
        ],
      },
      diagram_note: null,
    },
    { key: "critical_paths", status: "available", entries: [{ path: "src/app.ts", role: "Entry point" }] },
    {
      key: "local_run",
      status: "available",
      steps: [
        { order: 2, instruction: "Start the server", command: "pnpm dev", source: "README.md" },
        { order: 1, instruction: "Install dependencies", command: "pnpm install", source: "package.json" },
      ],
    },
    { key: "reading_path", status: "available", entries: [{ order: 1, path: "src/app.ts", reason: "Start here" }] },
    { key: "first_tasks", status: "unavailable", reason: "The index has no code evidence to suggest grounded first tasks." },
  ],
};

export function stateFixture(over: Partial<OnboardingTourState> = {}): OnboardingTourState {
  return {
    repo_id: "11111111-1111-4111-8111-111111111111",
    availability: "ready",
    current_index: { source_sha: SHA, indexed_at: "2026-10-11T10:00:00.000Z", index_status: "full" },
    tour: { tour_id: "22222222-2222-4222-8222-222222222222", repo_id: "11111111-1111-4111-8111-111111111111", content, provenance },
    stale: false,
    generation: { status: "idle", request_id: null, trigger: null, requested_at: null, error_category: null, message: null },
    permissions: { can_regenerate: true, can_share: true, denied_reason: null },
    public_origin_configured: true,
    ...over,
  };
}
