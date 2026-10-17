import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// "quality" cases run with no tools (skillTask injects SKILL.md + references/*.md only), so each
// prompt inlines the diff and the environment facts the skill would normally gather itself.
// Rules these cases expect, and where they live:
//   - SKILL.md: status values PASS/BLOCKED/REVIEW_FAILED/PARTIAL, blocking rule, output contract
//   - references/skill-routing.md: path -> skill map, "Non-matches", `uncovered` for unmapped files
//   - references/finding-policy.md: severity, confidence, dedup, status calculation
//   - references/project-checklist.md: Zod at the route boundary, append-only migrations, shared symlink
// Fixtures are minimal diffs shaped like real files of this repo (see fixtures/).

const CONTEXT = `Environment (already collected — treat it as given, do not ask for tool access or more data):
- Local manual mode: the diff below is the staged + unstaged working-tree change; it is the complete review range.
- No .pr-self-review.yml exists, so repository defaults apply.
- Repository-local skills available: ui-frontend-architecture, next-best-practices, react-best-practices, fastify-best-practices, onion-architecture, security, zod, typescript-expert, drizzle-orm-patterns, postgresql-table-design, react-testing-library, mermaid-diagram.
- Produce the final report directly from the diff.`;

export const cases: SkillCase[] = [
  {
    name: "routes a mixed diff to the mapped skills only and reports uncovered files",
    kind: "quality",
    prompt: `Review my current diff before I open a PR.\n\n${CONTEXT}\n\n${fx("mixed-routing.diff")}`,
    grounding: ["PASS"],
    practices: [
      "the report states a final status that is one of PASS, BLOCKED, REVIEW_FAILED or PARTIAL, and explains why that status was selected",
      "the report states the review range (local working-tree changes) and counts the changed files (4 files)",
      "the report lists the skills that ran and the skills that were skipped, rather than only the ones that ran",
      "frontend skills (e.g. react-best-practices, next-best-practices or ui-frontend-architecture) are applied to client/src/app/agents/page.tsx, and backend skills (e.g. fastify-best-practices, zod, security or onion-architecture) are applied to the server route file",
      "database skills (drizzle-orm-patterns, postgresql-table-design) are listed as skipped or not applicable, since no database file changed",
      "pnpm-lock.yaml is not reviewed as code: it is reported as an excluded/generated lock file, or as uncovered, and the report does not suggest hand-editing it",
      "docs/notes/weekly-sync.md is reported as uncovered/not applicable, or skipped, and no documentation skill such as mermaid-diagram is claimed to have reviewed it",
      "the report notes that defaults were used because .pr-self-review.yml is absent",
    ],
    threshold: 0.7,
    maxTurns: 6,
  },
  {
    name: "blocks a confirmed workspace-isolation break with evidence and a remediation",
    kind: "quality",
    prompt: `Review my current diff before I open a PR.\n\n${CONTEXT}\n\n${fx("auth-bypass.diff")}`,
    grounding: ["BLOCKED"],
    practices: [
      "the final status is BLOCKED",
      "the report has a finding on server/src/modules/reviews/adapters/inbound/http/routes.ts about GET /reviews/:id no longer filtering by workspace (getById replaced getByIdInWorkspace), i.e. cross-workspace data exposure",
      "that finding is rated with high confidence and with severity critical or high, and the report explains that it blocks because it is an authorization / data-isolation boundary failure",
      "the finding gives evidence quoted from the diff (e.g. the removed getByIdInWorkspace call or the added getById call), not a generic statement",
      "the finding includes a concrete remediation direction, such as restoring the workspace-scoped lookup at the server boundary",
      "the same defect is reported once as one canonical finding (possibly listing several corroborating skills), not repeated as separate duplicate findings per skill",
    ],
    threshold: 0.7,
    maxTurns: 6,
  },
  {
    name: "does not block a harmless refactor and still states coverage limitations",
    kind: "quality",
    prompt: `Review my current diff before I open a PR.\n\n${CONTEXT}\n\n${fx("benign-refactor.diff")}`,
    grounding: ["PASS"],
    practices: [
      "the final status is PASS, not BLOCKED",
      "the report does not invent critical or high severity findings for a behavior-preserving string-template refactor; any findings are low or medium and advisory",
      "the report mentions a coverage limitation or scope note (e.g. only one file reviewed, tests not run) even though the status is PASS",
      "the report applies the typescript-expert skill (or equivalently explains that only the skills relevant to reviewer-core were run) and does not run frontend or database skills",
      "the report does not claim to have verified that the grounding step or any tests still pass, since no test or grounding code was executed or shown",
    ],
    threshold: 0.7,
    maxTurns: 6,
  },
  {
    name: "flags a copied shared-contract tree and a rewritten migration",
    kind: "quality",
    prompt: `Review my current diff before I open a PR.\n\n${CONTEXT}\n\n${fx("shared-copy.diff")}`,
    practices: [
      "reports that client/src/vendor/shared was changed from a symlink into a regular directory with a copied file, violating the rule that server/src/vendor/shared is canonical and the client path must remain a symlink",
      "reports that server/src/db/migrations/0012_add_review_status.sql is an edit to an existing migration, violating the append-only migration history, and recommends a new migration instead",
      "notes that adding a NOT NULL column with a default to an existing table is a migration safety concern for already-applied environments, or otherwise ties the migration finding to data/migration safety",
      "the final status is not PASS",
      "database skills (drizzle-orm-patterns or postgresql-table-design) are listed as run for the migration file",
    ],
    threshold: 0.7,
    maxTurns: 6,
  },
  {
    name: "does not report PASS when a required skill is unavailable",
    kind: "quality",
    prompt: `Review my current diff before I open a PR.

Environment (already collected — treat it as given, do not ask for tool access or more data):
- Local manual mode: the diff below is the complete review range.
- No .pr-self-review.yml exists, so repository defaults apply.
- The 'security' skill FAILED to load (tool error: skill not found). All other repository-local skills loaded fine.
- The diff touches an authenticated server route, so the security skill is required for this change.

${fx("auth-bypass.diff")}`,
    practices: [
      "the report lists the security skill as unavailable (or failed) in its skills section",
      "the report does not claim the diff was fully reviewed for security and states this as a coverage limitation",
      "the final status is REVIEW_FAILED or PARTIAL — or BLOCKED only because the visible diff itself proves a workspace-isolation break — and it is never a plain PASS",
      "the report does not label the incomplete review as PASS",
    ],
    threshold: 0.75,
    maxTurns: 6,
  },
];
