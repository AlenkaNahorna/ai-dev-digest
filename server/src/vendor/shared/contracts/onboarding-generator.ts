import { z } from 'zod';

/**
 * Onboarding Generator contracts (SPEC-2026-10-11-onboarding-generator).
 *
 * A dedicated, strictly bounded contract: the loosely typed legacy `Onboarding`
 * contract in `knowledge.ts` is NOT reused because its stored JSON was never
 * validated against source provenance. Import this file directly (it is not
 * re-exported from the shared barrel).
 *
 * Everything an LLM produced is bounded here so a hostile or runaway model
 * response can never exceed what the database, the API or the browser accepts.
 */

// ------------------------------------------------------------------ limits

/** Engineering defaults from the plan (Step 3). One place so tests/prompts agree. */
export const ONBOARDING_LIMITS = {
  /** Serialized model response, bytes. */
  responseBytes: 64 * 1024,
  /** Free-text section body (architecture summary), characters. */
  textChars: 8 * 1024,
  diagramNodes: 20,
  diagramEdges: 30,
  criticalPaths: 20,
  readingEntries: 20,
  setupSteps: 20,
  firstTasks: 5,
  taskFiles: 10,
  pathChars: 512,
  shortTextChars: 600,
} as const;

// ----------------------------------------------------------------- helpers

/** Repo-relative file path: no absolute/traversal/backslash/NUL/control characters. */
export function isSafeRelativePath(p: string): boolean {
  return (
    p.length > 0 &&
    p.length <= ONBOARDING_LIMITS.pathChars &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f\\]/.test(p) &&
    !p.startsWith('/') &&
    !/^[A-Za-z]:/.test(p) &&
    p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')
  );
}

export const RelativePath = z
  .string()
  .refine(isSafeRelativePath, { message: 'Must be a repo-relative path without traversal segments.' });
export type RelativePath = z.infer<typeof RelativePath>;

/** Single-line text (no newlines / control characters). */
const SingleLine = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), { message: 'Must be a single line of printable text.' });

const ShortText = z.string().min(1).max(ONBOARDING_LIMITS.shortTextChars);
const FullSha = z.string().regex(/^[0-9a-f]{40}$/, 'Must be a full 40-character commit SHA');

// ---------------------------------------------------------------- sections

/** The five sections in their fixed display order (AC-11). */
export const ONBOARDING_SECTION_KEYS = [
  'architecture',
  'critical_paths',
  'local_run',
  'reading_path',
  'first_tasks',
] as const;
export const OnboardingSectionKey = z.enum(ONBOARDING_SECTION_KEYS);
export type OnboardingSectionKey = z.infer<typeof OnboardingSectionKey>;

export const ONBOARDING_SECTION_TITLES: Record<OnboardingSectionKey, string> = {
  architecture: 'Architecture overview',
  critical_paths: 'Critical paths',
  local_run: 'How to run locally',
  reading_path: 'Guided reading path',
  first_tasks: 'First tasks',
};

/** Explicit "no supporting evidence" state for a section (AC-22). */
const Unavailable = <K extends OnboardingSectionKey>(key: K) =>
  z.object({
    key: z.literal(key),
    status: z.literal('unavailable'),
    reason: ShortText,
  });

/** Diagram: a typed, bounded node/edge graph — never Mermaid/HTML/links from the model. */
export const DiagramNodeKind = z.enum(['client', 'service', 'module', 'datastore', 'external', 'other']);
export const DiagramNode = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'Node id must be a short lowercase slug'),
  label: SingleLine(60),
  kind: DiagramNodeKind,
  /** Anchors the node to an indexed file; absent for conceptual nodes (e.g. a datastore). */
  path: RelativePath.nullable(),
});
export type DiagramNode = z.infer<typeof DiagramNode>;

export const DiagramEdge = z.object({
  from: z.string(),
  to: z.string(),
  label: SingleLine(40).nullable(),
});
export type DiagramEdge = z.infer<typeof DiagramEdge>;

export const ArchitectureDiagram = z
  .object({
    nodes: z.array(DiagramNode).min(2).max(ONBOARDING_LIMITS.diagramNodes),
    edges: z.array(DiagramEdge).max(ONBOARDING_LIMITS.diagramEdges),
  })
  .superRefine((d, ctx) => {
    const ids = new Set<string>();
    for (const n of d.nodes) {
      if (ids.has(n.id)) ctx.addIssue({ code: 'custom', message: `Duplicate node id "${n.id}"` });
      ids.add(n.id);
    }
    for (const e of d.edges) {
      if (!ids.has(e.from) || !ids.has(e.to)) {
        ctx.addIssue({ code: 'custom', message: `Edge ${e.from}→${e.to} references an unknown node` });
      }
    }
  });
export type ArchitectureDiagram = z.infer<typeof ArchitectureDiagram>;

export const ArchitectureSection = z.discriminatedUnion('status', [
  z.object({
    key: z.literal('architecture'),
    status: z.literal('available'),
    /** Markdown (rendered without raw HTML). Always present, even when the diagram is not. */
    summary: z.string().min(1).max(ONBOARDING_LIMITS.textChars),
    /** null = no graph evidence could support a diagram (text summary remains the fallback). */
    diagram: ArchitectureDiagram.nullable(),
    diagram_note: ShortText.nullable(),
  }),
  Unavailable('architecture'),
]);

export const CriticalPathEntry = z.object({
  path: RelativePath,
  role: ShortText,
});
export const CriticalPathsSection = z.discriminatedUnion('status', [
  z.object({
    key: z.literal('critical_paths'),
    status: z.literal('available'),
    entries: z.array(CriticalPathEntry).min(1).max(ONBOARDING_LIMITS.criticalPaths),
  }),
  Unavailable('critical_paths'),
]);

export const SetupStep = z.object({
  order: z.number().int().min(1).max(ONBOARDING_LIMITS.setupSteps),
  instruction: ShortText,
  /** The exact command to copy; null for instructions that are not a command. */
  command: SingleLine(300).nullable(),
  /** The repository document/config this step is grounded in (AC-14). */
  source: RelativePath,
});
export const LocalRunSection = z.discriminatedUnion('status', [
  z.object({
    key: z.literal('local_run'),
    status: z.literal('available'),
    steps: z.array(SetupStep).min(1).max(ONBOARDING_LIMITS.setupSteps),
  }),
  Unavailable('local_run'),
]);

export const ReadingEntry = z.object({
  order: z.number().int().min(1).max(ONBOARDING_LIMITS.readingEntries),
  path: RelativePath,
  reason: ShortText,
});
export const ReadingPathSection = z.discriminatedUnion('status', [
  z.object({
    key: z.literal('reading_path'),
    status: z.literal('available'),
    entries: z.array(ReadingEntry).min(1).max(ONBOARDING_LIMITS.readingEntries),
  }),
  Unavailable('reading_path'),
]);

export const FirstTask = z.object({
  title: SingleLine(120),
  description: ShortText,
  files: z.array(RelativePath).max(ONBOARDING_LIMITS.taskFiles),
  /** A checkable completion outcome (AC-17). */
  outcome: ShortText,
});
export const FirstTasksSection = z.discriminatedUnion('status', [
  z.object({
    key: z.literal('first_tasks'),
    status: z.literal('available'),
    /** Always suggestions: they do not imply an existing issue or a proven defect. */
    tasks: z.array(FirstTask).min(1).max(ONBOARDING_LIMITS.firstTasks),
  }),
  Unavailable('first_tasks'),
]);

/**
 * Exactly five sections in a fixed order. A tuple (not an object) so that a
 * missing, duplicated or out-of-order section is rejected by the schema itself.
 */
export const OnboardingTourContent = z.object({
  sections: z.tuple([
    ArchitectureSection,
    CriticalPathsSection,
    LocalRunSection,
    ReadingPathSection,
    FirstTasksSection,
  ]),
});
export type OnboardingTourContent = z.infer<typeof OnboardingTourContent>;

export type ArchitectureSectionT = z.infer<typeof ArchitectureSection>;
export type CriticalPathsSectionT = z.infer<typeof CriticalPathsSection>;
export type LocalRunSectionT = z.infer<typeof LocalRunSection>;
export type ReadingPathSectionT = z.infer<typeof ReadingPathSection>;
export type FirstTasksSectionT = z.infer<typeof FirstTasksSection>;

// -------------------------------------------------------------- provenance

/** What the evidence capture included/skipped — sampled evidence is never presented as exhaustive. */
export const EvidenceReport = z.object({
  documents_used: z.number().int().nonnegative(),
  documents_skipped: z.number().int().nonnegative(),
  excerpts_used: z.number().int().nonnegative(),
  ranked_files: z.number().int().nonnegative(),
  critical_chains: z.number().int().nonnegative(),
  symbols: z.number().int().nonnegative(),
  /** Secret-bearing documents excluded whole + lines redacted inside allowed documents. */
  documents_excluded_for_secrets: z.number().int().nonnegative(),
  lines_redacted: z.number().int().nonnegative(),
  truncated: z.boolean(),
  /** Short, human-readable notes (e.g. "inventory capped at 50000 paths"). */
  notes: z.array(z.string().max(200)).max(12),
});
export type EvidenceReport = z.infer<typeof EvidenceReport>;

/** Provenance shown with a tour and copied into a public snapshot (AC-21). */
export const TourProvenance = z.object({
  source_sha: FullSha,
  indexed_at: z.string().datetime({ offset: true }),
  indexer_version: z.number().int().nonnegative(),
  index_status: z.enum(['full', 'partial']),
  generated_at: z.string().datetime({ offset: true }),
  evidence: EvidenceReport,
  /** Sections whose model output failed validation/grounding and were stored as unavailable. */
  degraded_sections: z.array(OnboardingSectionKey).max(5),
});
export type TourProvenance = z.infer<typeof TourProvenance>;

// ---------------------------------------------------------------------- DTOs

export const OnboardingTourVersion = z.object({
  tour_id: z.string().uuid(),
  repo_id: z.string().uuid(),
  content: OnboardingTourContent,
  provenance: TourProvenance,
});
export type OnboardingTourVersion = z.infer<typeof OnboardingTourVersion>;

/** Safe failure categories — raw provider errors/stacks/prompts are never exposed. */
export const GenerationErrorCategory = z.enum([
  'configuration',
  'evidence_unavailable',
  'invalid_output',
  'timeout',
  'provider_failure',
  'internal',
]);
export type GenerationErrorCategory = z.infer<typeof GenerationErrorCategory>;

export const GenerationStatus = z.enum(['idle', 'queued', 'running', 'failed', 'budget_reached']);
export type GenerationStatus = z.infer<typeof GenerationStatus>;

export const GenerationState = z.object({
  status: GenerationStatus,
  request_id: z.string().uuid().nullable(),
  trigger: z.enum(['automatic', 'manual']).nullable(),
  requested_at: z.string().datetime({ offset: true }).nullable(),
  error_category: GenerationErrorCategory.nullable(),
  /** Safe, user-facing explanation (no provider text). */
  message: z.string().max(300).nullable(),
});
export type GenerationState = z.infer<typeof GenerationState>;

/** What the tour screen needs to decide among its states (AC-1, AC-3, AC-6, AC-8). */
export const OnboardingAvailability = z.enum([
  /** No usable repo evidence: indexing is required first (AC-3). */
  'index_required',
  /** Indexed, but no tour exists yet ("No tour yet" + owner-only Generate). */
  'no_tour',
  /** A successful tour exists. */
  'ready',
]);
export type OnboardingAvailability = z.infer<typeof OnboardingAvailability>;

export const OnboardingTourState = z.object({
  repo_id: z.string().uuid(),
  availability: OnboardingAvailability,
  /** The current usable index (if any) — drives the stale indicator (AC-23). */
  current_index: z
    .object({
      source_sha: FullSha,
      indexed_at: z.string().datetime({ offset: true }),
      index_status: z.enum(['full', 'partial']),
    })
    .nullable(),
  tour: OnboardingTourVersion.nullable(),
  stale: z.boolean(),
  generation: GenerationState,
  permissions: z.object({
    can_regenerate: z.boolean(),
    can_share: z.boolean(),
    /** Why owner actions are unavailable, when they are. */
    denied_reason: z.enum(['not_owner', 'owner_unassigned']).nullable(),
  }),
  /** False → Share still works for local use, but links are local-only. */
  public_origin_configured: z.boolean(),
});
export type OnboardingTourState = z.infer<typeof OnboardingTourState>;

/** 202 body of POST /repos/:id/onboarding-tour/regenerate. */
export const RegenerateAccepted = z.object({
  request_id: z.string().uuid(),
  status: z.enum(['queued', 'running']),
});
export type RegenerateAccepted = z.infer<typeof RegenerateAccepted>;

// -------------------------------------------------------------------- shares

export const ShareCreateInput = z.object({
  /** The exact displayed version being published (never "whatever is latest"). */
  tour_id: z.string().uuid(),
});
export type ShareCreateInput = z.infer<typeof ShareCreateInput>;

export const ShareCreated = z.object({
  share_id: z.string().uuid(),
  tour_id: z.string().uuid(),
  /** The raw link — returned ONLY here; later listings expose opaque metadata only. */
  url: z.string().url(),
  /** True when no PUBLIC_WEB_ORIGIN is configured: the link only works on this machine. */
  local_only: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
});
export type ShareCreated = z.infer<typeof ShareCreated>;

export const ShareMeta = z.object({
  share_id: z.string().uuid(),
  tour_id: z.string().uuid().nullable(),
  source_sha: FullSha,
  created_at: z.string().datetime({ offset: true }),
  revoked_at: z.string().datetime({ offset: true }).nullable(),
  /** True for shares the requester created (only those can be revoked by them). */
  created_by_me: z.boolean(),
});
export type ShareMeta = z.infer<typeof ShareMeta>;

export const ShareList = z.object({ shares: z.array(ShareMeta) });
export type ShareList = z.infer<typeof ShareList>;

export const ShareRevoked = z.object({
  share_id: z.string().uuid(),
  revoked_at: z.string().datetime({ offset: true }),
});
export type ShareRevoked = z.infer<typeof ShareRevoked>;

/**
 * GET /public/onboarding/:token — the ONLY anonymous read. Minimal by design:
 * stored tour content + provenance + what is needed to build provider source
 * links (AC-31). No ids, no raw documents, no host paths, no private metadata.
 */
export const PublicOnboardingSnapshot = z.object({
  repository: z.object({
    provider: z.literal('github'),
    full_name: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  }),
  content: OnboardingTourContent,
  provenance: TourProvenance,
  shared_at: z.string().datetime({ offset: true }),
});
export type PublicOnboardingSnapshot = z.infer<typeof PublicOnboardingSnapshot>;

/** Opaque share token: 32 random bytes, base64url (43 chars). Validated at the edge. */
export const ShareToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
