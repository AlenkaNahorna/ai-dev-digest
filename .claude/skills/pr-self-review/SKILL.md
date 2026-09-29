---
name: pr-self-review
description: Review the current Git diff before opening or merging a pull request. Route changed files to the relevant repository skills, report evidence-backed findings, and block merge only for confirmed critical issues.
metadata:
  version: "1.0.0"
  scope: "Local PR review for the DevDigest monorepo"
---

# PR Self Review

Use this skill before opening a GitHub pull request, when manually requested, or
when a pull request is opened or updated in CI. Review the current diff and the
minimum surrounding context needed to understand it. Do not review unrelated
pre-existing problems as new findings.

## Required workflow

1. Read the repository and relevant package instructions before reviewing code.
   At minimum, use `AGENTS.md` and the applicable `INSIGHTS.md` files.
2. Determine the review range:
   - local manual mode: staged and unstaged working-tree changes;
   - pull-request mode: the merge-base-to-head diff;
   - never silently fall back to an unrelated branch or the full repository.
3. Enumerate added, modified, renamed, and deleted files. Ignore generated and
   vendored files only when repository configuration explicitly allows it.
4. Classify files using [references/skill-routing.md](references/skill-routing.md).
5. Load only the skills mapped to the changed files. A skill may inspect nearby
   unchanged code for context, but findings must be anchored to the diff when
   possible.
6. Apply the project-specific checks in
   [references/project-checklist.md](references/project-checklist.md).
7. Normalize, deduplicate, and rank findings using
   [references/finding-policy.md](references/finding-policy.md).
8. Report every relevant skill that ran, every relevant skill that was skipped,
   unclassified files, limitations, and the final mergeability status.

## Routing principles

- Run frontend skills on frontend files and backend skills on backend files.
- Run cross-cutting skills such as `security`, `typescript-expert`, and `zod`
  only when the changed code falls within their scope.
- Do not use an architecture skill as a substitute for a missing domain skill.
- If a file matches multiple domains, run all applicable skills and deduplicate
  findings by location and underlying issue.
- If no available skill covers a changed file, report `uncovered` rather than
  pretending the file was reviewed.
- If classification is ambiguous, report `unclassified` with the candidate
  categories and do not silently omit the file.

## Project invariants to protect

- `client/` is Next.js 15 + React 19 and follows React Server Components first.
- `server/` is Fastify + Drizzle + PostgreSQL; routes are schema-first with Zod.
- Server authentication and workspace membership are enforced at the server
  boundary, not only in the UI.
- Database migrations are manual and migration history is append-only.
- `server/src/vendor/shared` is canonical; `client/src/vendor/shared` remains a
  symlink and must not become a copied second contract tree.
- Modules use direct imports and do not introduce barrel exports.
- `reviewer-core` grounding remains deterministic after the model step.
- Tests follow the repository split: unit tests are hermetic; `*.it.test.ts`
  tests use PostgreSQL/integration infrastructure.

## Blocking rule

Return `BLOCKED` when at least one confirmed `critical` finding exists, or when
there is a high-confidence `high` security finding involving authentication,
authorization, cross-workspace/data isolation, secret handling, or injection.
Critical is reserved for demonstrated security compromise, secret exposure,
broken authorization, data loss or unsafe migration, a critical contract break,
or a confirmed production/runtime failure. A style preference, speculative
architecture concern, or low-confidence model hypothesis must not block merge.

Return `REVIEW_FAILED` when the reviewer cannot complete required checks because
of a tool, configuration, or unavailable-skill failure. Do not mislabel an
incomplete review as `PASS`. Whether `REVIEW_FAILED` blocks merge is a
repository policy decision and must be explicit.

## Output contract

Produce a concise report with:

- final status: `PASS`, `BLOCKED`, `REVIEW_FAILED`, or `PARTIAL`;
- changed-file counts and review range;
- skills run, skipped, unavailable, and uncovered file groups;
- findings grouped by severity;
- for each finding: skill, file, changed line or nearest diff hunk, evidence,
  impact, confidence, and a concrete remediation direction;
- suppressed or baseline findings, including their reason and expiration;
- a short explanation of why the final status was selected.

For GitHub enforcement, the local result must be exposed as a required status
check. A local non-zero exit code alone cannot prevent a GitHub merge; branch
protection must require the PR Self Review check. See
[references/github-integration.md](references/github-integration.md).

## Noise controls

- Prefer changed-line findings while reading enough surrounding context to avoid
  false positives.
- Trace input and data flow before reporting security issues.
- Report one canonical finding when multiple skills identify the same defect,
  while retaining all corroborating skills.
- Use `confidence: high|medium|low`; high-confidence critical findings and
  high-confidence security-boundary findings are blocking by default.
- Support repository-owned suppressions with an owner, reason, and expiry date.
- For oversized diffs, report reduced coverage and do not claim a complete
  review.

## Repository configuration

If `.pr-self-review.yml` exists, load it before classifying files. It may define
path rules, excluded generated files, required skills, critical policy,
suppression storage, and whether `REVIEW_FAILED` is blocking. If it does not
exist, use the defaults in the references and report that defaults were used.
