# Implementation Plan: Export to CI (SPEC-2026-10-17-export-to-ci)

**Date:** 2026-10-18
**Execution mode:** multi-agent. Main flow = 5 agents: A implementer (server + contracts + migration + runner), B implementer (client), C `test-writer`, D `architecture-reviewer`, E `plan-verifier`. **Implementers write NO tests** (production code only); all tests are written by C. A and B run in parallel; then C; then D and E; then the capped fix loop (see "Fix loop"). Security review is done inline by A via the `security` skill checklist (no `security-reviewer` slot).
**Modules affected:** server (`modules/ci`, `db/schema/ci.ts`, migration 0020, vendored contract `eval-ci.ts`), client (`features/ci-export` or agent-editor CI tab + `app/ci-runs`), agent-runner (`artifact.ts`, `run.ts`, `index.ts`), shared contracts.
**Requirements source:** `specs/SPEC-2026-10-17-export-to-ci.md` (approved, EARS AC-1..AC-20). Read fully; source of truth, not edited.
**INSIGHTS.md entries considered:**
- `INSIGHTS.md` (none specific to CI) — root only has the list/detail surface-separation note; not load-bearing here.
- `server/INSIGHTS.md:2026-09-27` DB integrity — multi-row/relationship writes must be in ONE Drizzle transaction (export persists `ci_installation` + token; ingest writes one `ci_runs` row — keep the dedupe check + insert atomic).
- `server/INSIGHTS.md:2026-09-27` boundary validation — reject duplicates/invalid at the API boundary even if the UI normalizes (ingest payload, export input).
- `server/INSIGHTS.md:2026-10-11` drizzle-kit FK/index names >63 chars silently truncate — declare a short explicit name for the new unique dedupe index on `ci_runs`.
- `server/INSIGHTS.md:2026-10-11` passing a JS `Date` as a bare `sql` param fails; use typed operators (`gte`/`lt`/`eq`) for the `ci_runs` ordering/filtering.
- `server/INSIGHTS.md:2026-09-21` vendored shared contracts are byte-identical copies, NOT symlinked at the file level — but note the client side is a *symlink directory* per root AGENTS.md; edit ONLY the canonical `server/src/vendor/shared/contracts/eval-ci.ts` (see Risk R1).
- `client/INSIGHTS.md:2026-10-11` split screens into a hook-owning route component + presentational `*View`; state matrices testable without mocking `AppShell`/`next/navigation` — apply to the CI Runs page and CI tab.
- `client/INSIGHTS.md:2026-10-11` client may import only *types* from vendored shared; response-boundary guards live in `features/<name>/model/parse.ts`, not server Zod at runtime.
- `client/INSIGHTS.md:2026-09-21` list-page previews are read-only; Accept/Dismiss stays on detail — CI Runs is a read-only list.

**Architectural constraints:**
- Onion architecture for the server `ci` module: `domain/` (manifest-serialize, workflow-text, verdict helpers — pure), `application/{dto,ports,use-cases}`, `adapters/inbound/http/routes.ts`, `adapters/outbound/persistence/*.repository.ts`. Routes must not import `drizzle-orm`/`src/db/*`; application/domain must not import Fastify/Drizzle/Octokit/`Container` (per `.claude/skills/onion-architecture/SKILL.md`; type-only imports count). GitHub access goes through an `application/ports/` interface implemented by an outbound adapter wrapping `container.github` (`commitFiles`/`openPullRequest`/`findOpenPr` already exist on `GitHubClient` — `server/src/vendor/shared/adapters.ts:143`).
- No barrel exports; register the module with one import + one entry in `server/src/modules/index.ts` (append-only — keep both on conflict with the parallel worktree) (root AGENTS.md "Stack rules"; `server/src/modules/index.ts:31`).
- All routes validate input with Zod (`params`/`body`); invalid → 422 before handler (`server/AGENTS.md#Key Rules`). Export/CI-tab/CI-Runs routes resolve workspace via `getContext` (`server/src/modules/_shared/context.ts`) and are scoped to it (AC-20). The ingest route is the ONE exception: authenticated by hashed bearer token, NOT `getContext`.
- Migration: generate `0020` with `pnpm db:generate` after editing `server/src/db/schema/ci.ts`; never hand-edit `_journal.json`; never rewrite past migrations (root AGENTS.md "Do Not Touch"; `server/AGENTS.md#Migrations`). The parallel multi-agent-review worktree takes `0019`; second-to-merge rebases and regenerates.
- Shared contract: edit the canonical `server/src/vendor/shared/contracts/eval-ci.ts` only; client consumes via the `src/vendor/shared` symlink — do NOT create a second client copy (root AGENTS.md "Shared contracts").
- Workflow YAML is a GENERATED file inside the target repo, not this repo's `.github/workflows/` — the "Do Not Touch `.github/workflows/`" rule does not apply to the generated string; the generator lives in the `ci` module.
- Client: RSC-first; `'use client'` only on the interactive leaf (dialog, mutation). TanStack Query hooks in `features/*/api`, typed keys in `src/shared/api/query-keys.ts` (`client/AGENTS.md#Key Rules`).
- Do NOT touch `server/src/db/schema/runs.ts`, `contracts`/`observability.ts`, or any `agent_runs`/`run_traces`/`multi_agent_runs` code (spec "Cross-feature boundary"; feature cap).

## Objective
Let an agent owner export a review agent into a target GitHub repo as versioned files (manifest, skill bodies, bundled runner, workflow) via a PR on `devdigest/ci`, run that agent in the target repo's GitHub Actions on `pull_request`, and ingest the run result back into a workspace-scoped `ci_runs` list. v1 is deliberately minimal: one target (GHA), one fixed workflow, one results table, hashed per-installation ingest token.

## Recommendations
- **Reuse the existing GitHub adapter verbatim.** `commitFiles` already layers files onto the base/branch tree, creates-or-updates `devdigest/ci`, and `findOpenPr` + `openPullRequest` cover "reuse or open" (AC-5) and never write the default branch. The `ci` module should depend on a narrow `GitHubExportPort` that delegates to `container.github`, not re-implement git plumbing. Trade-off: none — this is the lowest-risk path and keeps the module thin.
- **`DEVDIGEST_API_URL` needs no studio-server config.** It is an Actions *variable* the member sets in the target repo and the runner reads from env; the studio only needs its own reachable base URL to display in the dialog instructions. Do not add server config for it. Trade-off: the dialog copy must make clear the member supplies this value.
- **Mirror the `agents` module's pragmatic shape where the full onion split would be ceremony.** `agents/` uses `service.ts` + `helpers.ts` + outbound persistence rather than a `use-cases/` folder. The spec's security/boundary surface (ports for GitHub + token hashing) justifies ports here; keep pure serialization (manifest YAML, workflow text, verdict mapping) in `domain/` and avoid inventing use-case indirection with a single caller. Trade-off: slightly less uniform with `eval-pipeline`, but matches `agents` which this feature is closest to.

## Steps

1. **[shared] Extend `CiResultArtifact` and add the ingest request contract.** Add `repository`, `commit_sha`, `run_id`, `run_attempt`, `verdict` to `CiResultArtifact` (read by the runner from `GITHUB_*` env). Add severity-count persistence fields already present (`critical`/`warning`/`suggestion`) to the ingest flow. Keep new fields appropriately optional where the runner cannot always supply them, but make `repository`/`verdict` required for ingest matching. `verdict` uses the existing `Verdict`/`CiFailOn`-derived shape — confirm which enum; derive deterministically, never model self-report.
   - AC refs: AC-16
   - Files/areas: `server/src/vendor/shared/contracts/eval-ci.ts` (`CiResultArtifact`); extend `CiRun` with `verdict`, `commit_sha`, `run_id`, `run_attempt`, severity counts, `duration_s`.
   - Skills implementer should apply: zod — `schema-use-enums` (verdict/fail-on enums), `type-input-vs-output` (`.default()`/`.nullish()` keep caller input optional), `object-optional-vs-nullable`; typescript-expert — export both schema and inferred type.

2. **[server] Update `ci_runs` and `ci_installations` schema, then generate migration 0020.** Add to `ci_runs`: `verdict`, `commit_sha`, `run_id`, `run_attempt`, `critical`/`warning`/`suggestion` counts, `duration_s`/`duration_ms`, and the Actions job URL (reuse `github_url`). Add `ci_installations.token_hash` (hashed ingest token). Add a UNIQUE index on `(ci_installation_id, run_id, run_attempt)` for dedupe (AC-18) with a short explicit name (<63 chars). Run `pnpm db:generate`; review the generated `0020_*.sql`; do not touch `_journal.json` by hand.
   - AC refs: AC-7 (token_hash), AC-17 (columns), AC-18 (unique index)
   - Files/areas: `server/src/db/schema/ci.ts`, `server/src/db/migrations/0020_*.sql` (generated), `server/src/db/migrations/meta/*` (generated).
   - Skills implementer should apply: drizzle-orm-patterns — index on FK/dedupe columns, `$inferInsert`/`$inferSelect`; postgresql-table-design — `TIMESTAMPTZ` for `*_at`, `NUMERIC`/`doublePrecision` already used for cost, UNIQUE dedupe index is the `ON CONFLICT` target, prefer explicit short index name; engineering-insights — drizzle-kit truncates long FK/index names (declare short name).

3. **[server] Create the `ci` module skeleton (onion) and register it.** `domain/` pure helpers (manifest→YAML string, skill filename mapping, workflow YAML generator, verdict derivation), `application/ports/` (`GitHubExportPort`, `IngestTokenPort` for hashing/verifying), `application/dto`, `application/use-cases` (export, ingest, list-installations, list-ci-runs), `adapters/inbound/http/routes.ts`, `adapters/outbound/persistence/ci.repository.ts`, `adapters/outbound/providers/github-export.ts`. Add `ci` to `server/src/modules/index.ts` (append-only). Wire concrete adapters in the module `index.ts`/composition root, never pass whole `Container` into use-cases.
   - AC refs: AC-20 (module boundary/scoping foundation)
   - Files/areas: `server/src/modules/ci/**`, `server/src/modules/index.ts`.
   - Skills implementer should apply: onion-architecture — required module shape, narrow ports, no Fastify/Drizzle in domain/application, no barrel exports in `index.ts`; fastify-best-practices — plugin encapsulation, thin handlers; typescript-expert.

4. **[server] Implement the export use-case + route `POST /agents/:id/export-ci`.** Serialize the agent (name, provider, model, system prompt, skill slugs, strategy, `ci_fail_on`) with `AgentManifest`; reject on validation failure (AC-4). Build the four file groups (AC-3): `.devdigest/agents/<slug>.yaml`, `.devdigest/skills/<slug>.md` per skill (zero skills → none, edge case), `.devdigest/runner/index.js` (the ncc-built bundle — read from the built agent-runner artifact), `.github/workflows/devdigest-review.yml`. Create/update branch `devdigest/ci`, reuse open PR or open "Add DevDigest CI review", never the default branch (AC-5); on GitHub failure show a clear error and write nothing (AC-6). Persist one `ci_installation` per `(agent, repo)` reconciling if present; generate ingest token, store hashed, return plaintext once (AC-7). Scope to workspace via `getContext` (AC-20).
   - AC refs: AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8 (dialog data assembled server-side where applicable)
   - Files/areas: `server/src/modules/ci/application/use-cases/export.ts`, `domain/manifest.ts`, `domain/workflow.ts`, `adapters/outbound/providers/github-export.ts`, `adapters/inbound/http/routes.ts`, `adapters/outbound/persistence/ci.repository.ts`.
   - Skills implementer should apply: zod — validate `CiExportInput` body, `parse-use-safeparse` + generic error on manifest failure; security — token generated with CSPRNG, stored only hashed (A04), never return/display any secret *value* member must add (AC-8/AC-14), least-privilege; drizzle-orm-patterns — installation reconcile via upsert/transaction; onion-architecture — GitHub only through the port.

5. **[server] Generate the fixed workflow YAML (domain, pure).** `on: pull_request` types `opened`/`synchronize`/`reopened`; run `node .devdigest/runner/index.js`; no unpublished external action (AC-9). `permissions: contents: read, pull-requests: write` (AC-11). Skip fork PRs via a job-level condition; never `pull_request_target` with untrusted checkout (AC-12). Never interpolate `${{ github.event.* }}` into `run:`; pass PR data through env the runner reads (AC-13); any external action pinned to full SHA (AC-13 — v1 uses none). Secrets referenced only as `secrets.OPENROUTER_API_KEY` / `secrets.DEVDIGEST_INGEST_TOKEN` and the `vars.DEVDIGEST_API_URL` variable; no secret values embedded (AC-14).
   - AC refs: AC-9, AC-11, AC-12, AC-13, AC-14
   - Files/areas: `server/src/modules/ci/domain/workflow.ts`.
   - Skills implementer should apply: security — A05/injection (untrusted event data never in shell), A02 (least-privilege token), A04/A14 (no secret values in generated files); typescript-expert — pure string builder, no Fastify/Drizzle imports (domain layer).

6. **[server] Implement the ingest use-case + route (bearer-token authenticated, NOT workspace auth).** `POST` endpoint reads `Authorization: Bearer <token>`, looks up the installation by `token_hash`, returns a generic error on missing/unknown/invalid token (AC-15). Validate body with extended `CiResultArtifact`; reject if `repository` mismatches the installation's repo (AC-16). On valid input write one `ci_runs` row with all fields (AC-17); if `(installation, run_id, run_attempt)` already exists return success without a second row (AC-18, unique index + `ON CONFLICT DO NOTHING`). Never write `agent_runs`/`run_traces`/`multi_agent_runs` (AC-17). Body size bounded by the default Fastify `bodyLimit` (already 1 MB in `app.ts`).
   - AC refs: AC-15, AC-16, AC-17, AC-18
   - Files/areas: `server/src/modules/ci/application/use-cases/ingest.ts`, `application/ports/ingest-token.ts`, `adapters/inbound/http/routes.ts`, `adapters/outbound/persistence/ci.repository.ts`.
   - Skills implementer should apply: security — A07 (constant-time hash compare, generic rejection, no enumeration), A01 (installation scoping by token, not by client-supplied id), A09 (never log token); zod — `parse-use-safeparse`, `parse-never-trust-json`, boundary validation; drizzle-orm-patterns — `onConflictDoNothing` on the dedupe index inside a transaction; engineering-insights — typed operators not bare `Date` params.

7. **[server] Implement CI-tab read (`GET /agents/:id/ci-installations`) and CI-Runs read (`GET /ci-runs`).** CI tab: list installations for the agent with repo + latest run outcome and relative time (AC-1). CI Runs: 50 most recent workspace runs ordered `ran_at` desc, `id` desc, with repository, PR, agent, verdict, findings count, cost, duration, Actions job URL; empty state when none (AC-19). Both scoped to workspace via `getContext`; validate params/query with Zod (AC-20).
   - AC refs: AC-1, AC-19, AC-20
   - Files/areas: `server/src/modules/ci/application/use-cases/list-installations.ts`, `list-ci-runs.ts`, `adapters/outbound/persistence/ci.repository.ts`, `adapters/inbound/http/routes.ts`.
   - Skills implementer should apply: drizzle-orm-patterns — join ci_runs↔installations↔agents, `.limit(50)`, order by typed columns; postgresql-table-design — composite order `(ran_at desc, id desc)`; zod — response serialization via contract; onion-architecture — repository returns rows, use-case maps to DTO, no HTTP shaping in repo.

8. **[agent-runner] Extend the artifact and add the POST-to-ingest step.** In `artifact.ts` add `repository`/`commit_sha`/`run_id`/`run_attempt`/`verdict` to the built `CiResultArtifact`, sourced from `GITHUB_REPOSITORY`/`GITHUB_SHA`/`GITHUB_RUN_ID`/`GITHUB_RUN_ATTEMPT` (via `CiEnv`/`context.ts`) and the deterministic verdict already computed in `run.ts` (`gateTriggered`/`toReviewPayload.event`). In `run.ts`/`index.ts` add a final step: after writing `devdigest-result.json`, POST it to `$DEVDIGEST_API_URL` with `Authorization: Bearer $DEVDIGEST_INGEST_TOKEN` (AC-15), injectable `fetchImpl` for tests. Preserve all reviewer-core invariants (deterministic verdict, never model self-report; hard failure ingests nothing — only POST when an artifact exists).
   - AC refs: AC-10 (verdict deterministic, already implemented — extend only), AC-15 (POST step), AC-16 (fields the server matches on)
   - Files/areas: `agent-runner/src/artifact.ts`, `agent-runner/src/run.ts`, `agent-runner/src/index.ts`, `agent-runner/src/context.ts` (new env reads), `*.test.ts` siblings.
   - Skills implementer should apply: security — A09 never log the bearer token or key, A14 token/key never in artifact; typescript-expert — keep deps injectable (`fetchImpl`, `now`) for hermetic tests; zod — artifact still `safeParse`d against the shared contract before POST. (No dedicated runner skill; follow `agent-runner/CLAUDE.md` invariants.)

9. **[client] Add the CI tab to the Agent Editor.** Append a `{ key: "ci", ... }` tab to `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` `TABS` (append-only). CI tab shows installations (repo + latest outcome + relative time) via a TanStack Query hook, and an "Add to CI" button opening ONE dialog: choose target repo (`owner/name`), preview generated files with contents, confirm. Dialog lists required secrets (`OPENROUTER_API_KEY`, `DEVDIGEST_INGEST_TOKEN`), the `DEVDIGEST_API_URL` variable, the branch-protection note, and shows the ingest token once; never requests/displays any secret value (AC-8). Submit calls `POST /agents/:id/export-ci`.
   - AC refs: AC-1, AC-2, AC-8
   - Files/areas: `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`, a new `CiTab` component + `features/ci-export/{api,model,ui}`, `src/shared/api/query-keys.ts` (new key root).
   - Skills implementer should apply: react-best-practices — one dialog not a wizard, derive-don't-store, `'use client'` only on the dialog leaf, aria-label on icon buttons; ui-frontend-architecture — colocate under agent editor / feature slice, hook-owning component + presentational view; next-best-practices — RSC page entry, client boundary at the dialog; zod — client imports only *types* from shared, parse at the response boundary (`features/ci-export/model/parse.ts`).

10. **[client] Add the `/ci-runs` page.** Server-component route `client/src/app/ci-runs/page.tsx` + a hook-owning screen + presentational `*View`. Shows 50 most recent workspace CI runs (repository, PR, agent, verdict, findings count, cost, duration, link to the Actions job); empty state when none (AC-19). Nav key `ci-runs` already resolves in `client/src/components/app-shell/helpers.ts:39` — confirm the nav entry exists/append it (append-only registry).
   - AC refs: AC-19
   - Files/areas: `client/src/app/ci-runs/page.tsx`, `client/src/features/ci-runs/{api,model,ui}`, `client/src/components/app-shell/helpers.ts` (append-only if an entry is needed).
   - Skills implementer should apply: next-best-practices — RSC page, thin entrypoint; react-best-practices — read-only list, conditional-render empty state without `{count && ...}`, stable keys (row id not index); ui-frontend-architecture — feature slice, view/hook split; react-testing-library — list/empty/error flow tests.

11. **[tests] Written by Agent C (`test-writer`) only, after A and B finish — not by the implementers.** Covers server unit + `*.it.test.ts`, agent-runner, and client RTL tests (see Testing strategy). Client RTL part: One flow each: CI tab happy path (installations render → open dialog → preview files → confirm → token shown once), CI Runs happy path + empty state. Mock fetch at the boundary.
   - AC refs: AC-1, AC-2, AC-8, AC-19
   - Files/areas: test files only (`*.test.ts`, `*.it.test.ts`, `*.test.tsx`); C never edits production code.
   - Skills implementer should apply: react-testing-library — fewer longer flow tests, `getByRole`/`findBy`, `userEvent.setup()`, MSW/fetch mock at boundary, assert token-shown-once and no secret value echoed.

## Skill roster for implementer
| Skill | Applies to steps | Key rule to respect |
|-------|-------------------|----------------------|
| onion-architecture | 3,4,5,6,7 | Domain/application import no Fastify/Drizzle/Octokit/`Container` (type-only counts); GitHub only via `application/ports/`; no barrel exports in `index.ts`. |
| fastify-best-practices | 3,4,6,7 | Thin handlers: validate → use-case → map result/status; plugin encapsulation per module. |
| drizzle-orm-patterns | 2,4,6,7 | Index dedupe columns; `onConflictDoNothing` for AC-18; repository does persistence only; transactions for multi-write. |
| postgresql-table-design | 2 | `TIMESTAMPTZ` for `*_at`; UNIQUE dedupe index as `ON CONFLICT` target; short explicit index/FK names (<63 chars). |
| zod | 1,4,6,7,9,10 | Export schema+type; `safeParse` at boundaries; `parse-never-trust-json` on ingest; enums for verdict/fail-on; client imports types only. |
| security | 4,5,6,8 | Hashed token + generic rejection (A07); least-privilege workflow token + no secret values in generated files/logs/artifact (A02/A04/A14); untrusted event data never in `run:` (A05). |
| typescript-expert | all | Branded/explicit types at boundaries; injectable deps in runner; no implicit `any`. |
| engineering-insights | 2,6 | drizzle-kit truncates long index/FK names; never pass bare `Date` into `sql` template — use typed operators. |
| react-best-practices | 9,10,11 | Derive-don't-store; `'use client'` on the leaf only; stable keys; conditional render without `0` leak. |
| ui-frontend-architecture | 9,10 | Colocate in feature slice; hook-owning component + presentational view; dependency direction shared→feature→page. |
| next-best-practices | 9,10 | RSC-first page entrypoints; narrow client boundary at the dialog. |
| react-testing-library | 11 | Fewer longer flow tests; `getByRole`/`findBy`; mock fetch at boundary. |

## Testing strategy
- **Existing tests covering this area:** `agent-runner/src/{run,manifest,artifact,diff}.test.ts` (hermetic, LLM stubbed); server module tests under `server/test/` and per-module `*.test.ts`; `client/src/features/**/*.test.tsx`.
- **New tests needed (all written by Agent C `test-writer`, not by the implementers):**
  - Unit (hermetic): workflow generator (asserts no `${{ github.event` in `run:`, `permissions: contents: read / pull-requests: write`, fork-skip condition, `node .devdigest/runner/index.js`) — AC-9/11/12/13; manifest serializer (AgentManifest round-trip, zero-skills edge) — AC-4; verdict derivation determinism — AC-10; ingest token hashing/verify (generic rejection) — AC-15; dedupe logic — AC-18.
  - Integration (`*.it.test.ts`, Postgres via testcontainers): export persists one `ci_installation` reconciling on re-run and keeps the token (AC-7); ingest writes one `ci_runs` row (AC-17), rejects repo mismatch (AC-16), is idempotent on `(installation, run_id, run_attempt)` (AC-18); cross-workspace access to CI-tab/CI-Runs/export returns 403 (AC-20); unauthenticated/unknown-token ingest rejected generically (AC-15).
  - agent-runner: POST step called with Bearer header and parsed artifact, skipped on hard failure (no artifact) — AC-15, via injected `fetchImpl`.
  - Client: CI tab + CI Runs flow tests (step 11).
- **Commands to run:** server `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm architecture:check`; agent-runner `pnpm typecheck`, `pnpm test`, `pnpm build` (ncc) so step 4 can embed `dist/index.js`; client `pnpm typecheck`, `pnpm test`. Root `pnpm typecheck` across packages (shared-contract edit touches both compilation units).

## Agent allocation (5 agents, disjoint ownership)
- **Agent A — implementer: server + contracts + migration + runner** (steps 1–8). Owns `server/src/modules/ci/**`, `server/src/db/schema/ci.ts`, migration 0020, `server/src/vendor/shared/contracts/eval-ci.ts`, `server/src/modules/index.ts` (append-only), `agent-runner/src/**` (production files only). Writes **no tests**. Applies the `security` skill checklist inline to steps 4–6 and 8 (this replaces a separate security-reviewer).
- **Agent B — implementer: client** (steps 9–10). Owns `client/src/app/ci-runs/**`, the AgentEditor CI tab, `client/src/features/ci-*/**`, `client/src/shared/api/query-keys.ts`, `client/src/components/app-shell/helpers.ts` (append-only). Writes **no tests**. Disjoint from A → **A and B run in parallel**.
- **Agent C — `test-writer`** (step 11; after A+B). Writes and runs all tests, including the generated-file scan (no `${{ github.event` inside `run:`, no secret fixtures), edits test files only. Reports production bugs it finds rather than fixing them.
- **Agent D — `architecture-reviewer`** (after C). Onion boundaries, no barrel exports, module registration, dependency direction, migration journal untouched.
- **Agent E — `plan-verifier`** (after C, parallel with D). AC ↔ step ↔ code via the traceability table.
- **Dropped:** `security-reviewer` (cap). Add it back only if you accept a sixth agent.

## Fix loop (hard caps)
Triggered only by blocking findings from C (failing tests), D, or E.
- At most **2 subagents** may be spawned in the whole fix loop (e.g. 2 fix-implementer runs, or 1 fix run + 1 re-verification). Max **1 iteration of re-review** by the orchestrator itself without a new agent.
- Each fix agent gets only the confirmed findings, with file:line, and edits only the files named in them; it writes no tests (test fixes go back through C only if a slot is left).
- Hard stop after the second agent: unresolved findings are reported to the user verbatim; do not weaken tests, ACs, or thresholds to pass.
- Budget summary: 5 main agents + at most 2 fix-loop agents = 7 maximum. (If the original "5 total" cap must include the fix loop, drop D or E from the main flow and run the orchestrator's own review in its place.)

## Traceability (AC -> step)
| AC | Step(s) |
|----|---------|
| AC-1 | 7, 9 |
| AC-2 | 4, 9 |
| AC-3 | 4 |
| AC-4 | 4 |
| AC-5 | 4 |
| AC-6 | 4 |
| AC-7 | 2, 4 |
| AC-8 | 4, 9 |
| AC-9 | 5 |
| AC-10 | 8 (verdict already in runner `run.ts`; extend/propagate) |
| AC-11 | 5 |
| AC-12 | 5 |
| AC-13 | 5 |
| AC-14 | 4, 5, 8 |
| AC-15 | 6, 8 |
| AC-16 | 1, 6, 8 |
| AC-17 | 2, 6 |
| AC-18 | 2, 6 |
| AC-19 | 7, 10 |
| AC-20 | 3, 4, 6, 7 |

Every AC-1..AC-20 maps to >=1 step; every step maps to >=1 AC. No orphan steps, no uncovered ACs.

## Risks / open questions
- **R1 (contract copies):** root AGENTS.md says `client/src/vendor/shared` is a *symlink* to the canonical server source, but `server/INSIGHTS.md:2026-09-21` records that contract files were byte-identical *copies* in both trees. The implementer must verify on disk (`ls -l client/src/vendor/shared`) before editing: if it is a real symlink, edit only the server copy; if it is a duplicated file, edit both or the two compilation units drift. Resolve by inspection, not assumption.
- **R2 (verdict enum for ingest):** the spec names a `verdict` field but the existing `CiRun`/`CiResultArtifact` use `status`/`CiRunStatus` and reviewer-core uses `Verdict`. The implementer must pick one canonical enum for the persisted `verdict` and keep runner + ingest + CI-Runs read consistent. Flagged for the implementer to settle against reviewer-core's `toReviewPayload.event`; not resolved here to avoid guessing the contract.
- **R3 (runner bundle availability at export time):** step 4 embeds `.devdigest/runner/index.js` from agent-runner's ncc `dist/index.js`. The server must read that built artifact at export time. Confirm how the server locates it (bundled path vs build step) — if not resolvable, export cannot produce AC-3's runner file. Needs the implementer to verify the build/packaging path.
- **R4 (migration merge order):** if the multi-agent-review worktree merges first with `0019`, this feature rebases and regenerates `0020`; if this merges first, note it took `0020` and the other must become `0021`. Second-to-merge regenerates with `drizzle-kit`; never hand-edit `_journal.json`.
- **Open question (carried from spec):** no CI Runs page design exists; spec default accepted (columns per AC-19, row link opens the Actions job). Implemented to the default; flag if a design arrives.

## Explicit non-goals
- No specification was authored or modified; `specs/SPEC-2026-10-17-export-to-ci.md` is read-only input.
- No `agent_runs`/`run_traces`/`multi_agent_runs` writes; no edits to `server/src/db/schema/runs.ts`, `contracts`/`observability.ts`, or `/multi-agent` (parallel worktree).
- No `.github/workflows/` edits in THIS repo; no `docker-compose.yml`, lock files, or migration-journal hand-edits.
- Deferred-to-v2 items are out of scope: other CI targets (CircleCI/Jenkins/CLI), published GitHub Action, wizard/configurable triggers & post_as, zip export, secret-readiness status, workflow version display, mirroring CI runs into `agent_runs`, replay/out-of-order protection, hard-failure envelope, pagination beyond 50, manifest/skill size bounds, update diff preview, token rotation.
