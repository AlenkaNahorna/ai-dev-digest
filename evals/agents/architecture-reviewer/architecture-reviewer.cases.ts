import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// Shared by two agents so they are graded on exactly the same task:
//   - architecture-reviewer     (primary, skill: onion-architecture v1)
//   - architecture-reviewer-v2  (variant,  skill: onion-architecture-v2, adds the per-layer checklist)
// Any difference between them is therefore attributable to the onion skill version.
//
// Every fixture is a real file from this repo with one minimal change (see fixtures/). Rules these
// cases expect exist in the repo and nowhere else:
//   - server/.dependency-cruiser.js (e.g. domain-and-application-cannot-import-fastify)
//   - the onion architecture skill (v1 or v2): "Non-negotiable dependency direction", "Forbidden patterns"
//   - reviewer-core/AGENTS.md: "No database, GitHub, or filesystem"; "The grounding step is mandatory"
// The agents never issue a PASS/BLOCKED merge verdict, and emit severity critical/high/medium/low only.

const LAYERING_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("domain-fastify-type-import.diff")}
${fx("route-drizzle-import.diff")}`;

const SECURITY_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("security-open-redirect.diff")}`;

const REVIEWER_CORE_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("reviewer-core-gate.diff")}`;

const BENIGN_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("benign-refactor.diff")}`;

const VERDICT_RULE =
  "does not issue a PASS/BLOCKED merge verdict and ends with the line 'Findings: N (blocking_candidate: M) — merge status is decided by pr-self-review'";

export const cases: AgentCase[] = [
  {
    name: "flags the Fastify type in the domain layer and the Drizzle import in a route file",
    kind: "quality",
    prompt: LAYERING_PROMPT,
    practices: [
      "flags the type-only import `import type { FastifyReply } from 'fastify'` in server/src/modules/onboarding-generator/domain/lifecycle.ts as a violation: the domain layer must not import Fastify, and type-only imports count",
      "cites a rule that exists in the repo for that finding (server/.dependency-cruiser.js `domain-and-application-cannot-import-fastify`, or the onion skill's domain rule)",
      "flags `import { eq } from 'drizzle-orm'` in server/src/modules/repos/adapters/inbound/http/routes.ts as a violation: route files must not import drizzle-orm (onion skill, Forbidden patterns; dependency-cruiser `http-adapters-cannot-query-database-directly`)",
      "assigns a severity (critical/high/medium/low) and a blocking_candidate value to each finding",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      VERDICT_RULE,
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate an architecture finding for the security-only change",
    kind: "quality",
    prompt: SECURITY_PROMPT,
    practices: [
      "does not report the open redirect (`reply.redirect` with an unvalidated query parameter) as an architecture finding",
      "if it mentions the redirect at all, defers it to security-reviewer instead of reporting it as a finding",
      "does not invent a layering violation for the new route handler, which lives in an inbound adapter and uses only allowed imports",
      "stays scoped to structural/layering/DI findings and does not comment on naming, style, or test coverage",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "cites reviewer-core/AGENTS.md for the filesystem import and the skipped grounding gate",
    kind: "quality",
    prompt: REVIEWER_CORE_PROMPT,
    practices: [
      "flags the `import { readFileSync } from 'node:fs'` added to reviewer-core/src/review/run.ts as a violation of reviewer-core/AGENTS.md ('No database, GitHub, or filesystem; the only side effect is an injected LLM call')",
      "flags that `groundFindings(...)` was replaced by an inline object, skipping the grounding step that reviewer-core/AGENTS.md calls mandatory ('The grounding step is mandatory')",
      "cites reviewer-core/AGENTS.md as the rule source for both findings and does not invent rule identifiers that are not written in the repo",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "assigns a severity (critical/high/medium/low) and a blocking_candidate value to each finding",
      VERDICT_RULE,
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate a rule violation for a behaviour-preserving rename",
    kind: "quality",
    prompt: BENIGN_PROMPT,
    practices: [
      "reports no violations for the rename of local variables in scoreFromFindings (or records only low-severity, low-confidence observations) and does not invent a critical/high/medium finding",
      "does not fabricate a rule violation where the diff violates none of the checked rules",
      "reports zero findings (or only the low-confidence ones) and leaves the merge status to pr-self-review, without a PASS/BLOCKED verdict",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
];
