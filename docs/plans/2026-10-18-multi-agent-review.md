# Implementation Plan: Multi-Agent Review (worktree A)
**Date:** 2026-10-18
**Execution mode:** multi-agent — up to 3 `implementer` agents (2 preferred, disjoint file ownership, server-first order); review chain `architecture-reviewer` then `plan-verifier`; fix loop capped (see Fix-loop section). NO test-writer, NO tests authored.
**Modules affected:** server, client, shared contracts (`observability.ts`, `trace.ts`)
**Requirements source:** `specs/SPEC-2026-10-17-multi-agent-review.md` (AC-1..AC-58, decisions D1-D12 all RESOLVED)
**INSIGHTS.md entries considered:**
- server:2026-09-21 — PR-list badges count newest review per agent, no LLM on render → columns/conflicts are pure reads over persisted findings.
- server:2026-09-21 (nullish) + root:2026-09-17 — shared contracts are byte-identical copies in server+client vendor dirs; new fields must be edited in `server/src/vendor/shared` only (client is a symlink here).
- server:2026-10-11 (Drizzle Date) — use typed operators (`gte`/`lt`/`eq`), never bare `Date` in `sql` templates (estimate windowing).
- server:2026-10-11 (FK name length) — `agent_runs_multi_agent_run_id_multi_agent_runs_id_fk` may exceed 63 chars; declare a short explicit `foreignKey({ name })`.
- client:2026-09-21 — a completed review must invalidate the `pulls` query or the list keeps stale score/findings; multi-agent completion must invalidate review/run/pulls keys the same way.
- client:2026-10-11 (setParams) — change several query params in one `router.replace`; `?trace=` is set via `setParam`.

**Architectural constraints:**
- No barrel exports; path aliases only (root CLAUDE.md Key Rules; onion-architecture `index.ts` row).
- All new routes validate input with Zod before the handler; `422` on invalid (server CLAUDE.md; AC-54).
- Onion: route files must not import `drizzle-orm`/`src/db/*`; SQL lives in `adapters/outbound/persistence/`; use-cases own ports; no `Container` into application/domain (onion-architecture SKILL).
- Migrations manual, add-only, never edit journal; generate with `pnpm db:generate` (server CLAUDE.md Do Not Touch).
- Shared contracts edited in `server/src/vendor/shared` only; client consumes via symlink (client CLAUDE.md).
- Every request resolves workspace membership; cross-workspace = 403 (server CLAUDE.md auth boundary; D11, AC-21/53).
- RSC-first; `'use client'` only on interactive leaves (client CLAUDE.md; next/react skills).

## Objective
Add a multi-agent review surface on worktree A: pick a subset of agents, start one parent-grouped run, read results in Columns/Tabs with reused `RunTraceDrawer`, see cross-agent finding groups and a "Where agents disagree" view, with a pre-run estimate and an honest "1 vs N" block. Reuse the existing executor and trace drawer as-is; grouping and conflicts are pure functions computed on read. No parallel engine rewrite, no CI, no tests in this workflow.

## Recommendations
- **Executor concurrency (D2):** add an optional `concurrency` param (default 1) and bound the `for (const { agent, runId } of jobs)` loop at `run-executor.ts:143` with a small pool; do NOT touch `runOneAgent` or failure isolation. Keep change to the loop only — trade-off: honest `POOL_SIZE=3` wall-clock vs. a larger refactor the spec forbids.
- **409 guard gap:** `activeRunsForPull` (`run.repo.ts:10`) filters `status='running'` only, not `queued`. Current rows are created in `'running'` state (`run.repo.ts:158`), so checking `running` covers today's lifecycle. Keep the guard on `running`; if a `queued` state is later introduced the guard must widen. Flagged in Risks, not a blocker.
- Otherwise implement the spec literally; keep v1 minimal per the cut line below.

## Steps

### Implementer S1 — SERVER (runs FIRST; owns contracts + migration + all server code)
1. [shared] Edit `observability.ts`: `ConflictTake.verdict` add `'no_result'`; `AgentColumn` add `tokens_in`, `tokens_out`, status `'queued'`; `AgentColumnFinding` add `end_line`, `confidence`, `rationale`, `suggestion`, `state` (`open|accepted|dismissed`), `agent_id`; `MultiAgentRun` add `groups` (finding-id arrays) and `status` (`running|partial|failed|done`). Add estimate response `{ agent_id, mean_duration_ms, mean_cost_usd, sample_size }`.
   - AC refs: AC-20, AC-31, AC-35, AC-37, AC-42, AC-25, AC-11, AC-13
   - Files: `server/src/vendor/shared/contracts/observability.ts` only (client is a symlink here — one file).
   - Skills: zod (`type-export-schemas-and-types`, `schema-use-enums` for verdict/status/state); typescript-expert.
2. [shared] Edit `trace.ts`: add `schema_version: z.literal(1).default(1)`, optional on read (D5, AC-55).
   - AC refs: AC-55
   - Files: `server/src/vendor/shared/contracts/trace.ts`
   - Skills: zod (`refine-defaults`, optional-on-read).
3. [server] Add-only migration: nullable `agent_runs.multi_agent_run_id` FK → `multi_agent_runs.id` (`ON DELETE SET NULL`), short explicit FK name; index the FK column. Edit `src/db/schema/runs.ts`, then `pnpm db:generate`, review, do not edit the journal.
   - AC refs: AC-17, AC-18
   - Files: `server/src/db/schema/runs.ts`, new `server/src/db/migrations/00NN_*.sql`
   - Skills: drizzle-orm-patterns (FK via arrow fn, index FK col), postgresql-table-design (FK index manual, nullable add-only is fast), engineering-insights (short FK name).
4. [server] Executor: add optional `concurrency` param (default 1) bounding the loop at `run-executor.ts:143`; diff/intent still loaded once; isolation unchanged (D2).
   - AC refs: AC-16, AC-50
   - Files: `server/src/modules/reviews/run-executor.ts`
   - Skills: onion-architecture (no transport/SQL leakage), typescript-expert.
5. [server] Multi-run use-case/service: create one `multi_agent_runs` parent, create N `agent_runs` linked to it (extend `createAgentRun` at `service.ts:133`/`run.repo.ts:140` with optional `multiAgentRunId`), call `executeRuns(..., { concurrency: POOL_SIZE=3 })`. Guard: reject second start while a run on the PR is active → 409 `multi_agent_run_active` (reuse `activeRunsForPull`). N between 1 and 6.
   - AC refs: AC-5, AC-17, AC-19, edge "concurrent starts" (409), edge "huge diffs/6 agents"
   - Files: `server/src/modules/reviews/service.ts`, `.../persistence/run.repo.ts`, new application/use-case + port under `server/src/modules/reviews/` (onion shape)
   - Skills: onion-architecture (use-case owns tx boundary, narrow ports, no Container), fastify-best-practices, engineering-insights (Drizzle typed operators).
6. [server] Results read-model: load all runs of a parent by id (not `ran_at` window), build columns from `agent_runs` + newest `reviews`/`findings`; compute `status`, totals (sum of actual costs, exclude null `cost_usd`), groups, conflicts.
   - AC refs: AC-18, AC-20, AC-39, AC-48, AC-49, AC-52, edge "zero findings"
   - Files: `.../reviews/adapters/outbound/persistence/*`, results use-case
   - Skills: onion-architecture, drizzle-orm-patterns, typescript-expert.
7. [server] Pure grouping + conflicts functions (domain). Grouping: same file AND line overlap ±`LINE_TOLERANCE=3` AND (same `category` OR title-token Jaccard ≥ `TITLE_JACCARD_MIN=0.5`); never groups two findings of one agent; deterministic stable order; constants defined once (D4, AC-27). Conflicts: ≥1 agent flagged and ≥1 completed agent did not, OR severities differ ≥2 levels; failed/running take = `no_result`; "did not flag" note = neutral derived text + link (D3, AC-34).
   - AC refs: AC-22, AC-23, AC-26, AC-27, AC-28, AC-29, AC-30, AC-31, AC-34
   - Files: new `server/src/modules/reviews/<grouping>/` domain (pure, no DB/Fastify imports)
   - Skills: typescript-expert, onion-architecture (domain purity, no infra imports).
8. [server] Estimate use-case: mean duration + mean cost of each agent's last 5 `status='done'` AND `source='local'` runs workspace-wide (not PR-scoped); `sample_size<1` → unavailable (D8). Use typed Drizzle operators.
   - AC refs: AC-11, AC-13, AC-14, cross-worktree `source='local'` filter
   - Files: results/estimate use-case + persistence query
   - Skills: drizzle-orm-patterns, postgresql-table-design, engineering-insights (no bare Date in sql), typescript-expert.
9. [server] Routes (Zod-validated, workspace-scoped): `POST /pulls/:id/multi-agent-run` (non-empty agent-id array, 1..6, else 422; own rate limit 5/min; 409 on active), `GET /pulls/:id/multi-agent/:parentId`, estimate endpoint. Cross-workspace → 403 (D11). No change to `RunRequest` or `POST /pulls/:id/review` (D1).
   - AC refs: AC-5, AC-18, AC-21, AC-53, AC-54, edge "rate limit 5/min"
   - Files: `server/src/modules/reviews/adapters/inbound/http/routes.ts` (add routes), `server/src/modules/index.ts` (add-only lines, no reformat — cross-worktree rule)
   - Skills: fastify-best-practices (schema-first, rate-limit per route), zod (`parse-validate-early`, non-empty array), security (A01 workspace boundary, A05 input validation), onion-architecture (thin handler → use-case, no SQL in route).

### Implementer S2 — CLIENT (runs AFTER S1; owns all `client/` code)
10. [client] Feature slice `features/multi-agent-review/{api,model,ui}`: TanStack Query hooks (start mutation, results poll every 2s while any run active per AC-36, estimate), typed keys in `src/shared/api/query-keys.ts`. On completion invalidate review/run/pulls keys (client INSIGHTS 2026-09-21). Also dedupe SSE events by `seq` in `useRunEvents` (`client/src/features/reviews/api/hooks.ts:23`; verified: `lib/hooks/reviews.ts` has no seq handling) — owned by S2, D7.
   - AC refs: AC-36, cross-module cache invalidation
   - Files: `client/src/features/multi-agent-review/**`, `client/src/shared/api/query-keys.ts`
   - Skills: react-best-practices (data fetching in hooks, no SSE on results page), next-best-practices, ui-frontend-architecture (feature-slice ownership), typescript-expert.
11. [client] Agent picker on PR header: lists all workspace agents with checkboxes, preselects enabled (disabled listed, not selectable), Clear, count on primary button, disabled when 0, "Configure agents…" link. Start posts selected ids.
   - AC refs: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6
   - Files: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/**` (or sibling; do NOT change existing single-agent/"Run all" behavior), feature `ui/`
   - Skills: react-best-practices (derive don't store, controlled checkboxes), react/next, security (A05 render model text as plain text), ui-frontend-architecture.
12. [client] Results page under `/multi-agent` (nav key already lights up, `helpers.ts:28`): Columns mode (status badge queued/running/done/failed, score, duration, cost, finding cards, count, "View trace"), Tabs+detail mode, Columns|Tabs toggle, "Where agents disagree" block with "Show only conflicts" toggle, finding groups collapsed/expandable. The "1 vs N" block is NOT in this step (owned by S3 / Phase 3). URL: `/multi-agent?pr=<prId>&run=<parentId>`; the picker navigates there after start; `prNumber` for the drawer comes from `MultiAgentRun.pr_number` (omit when null). "View trace" sets `?trace=<run_id>` and mounts the EXISTING `RunTraceDrawer` (reused as-is per `PullDetailScreen.tsx:62`) — no new drawer. Accept/Dismiss call existing `POST /findings/:id/(accept|dismiss)`; group action hits every original (D12, AC-46). Reply/Learn/Turn-into-eval = disabled with "not available yet" tooltip (D10, AC-45). All strings from `messages/en/*.json` (add-only lines).
   - AC refs: AC-35, AC-36, AC-37, AC-38, AC-39, AC-40, AC-41, AC-42, AC-43, AC-44, AC-45, AC-46, AC-47, AC-48..AC-50, AC-52, AC-24, AC-25, AC-32, AC-33, AC-57, estimate footer AC-12/15/16
   - Files: `client/src/app/multi-agent/**` (new route), feature `ui/`, `client/messages/en/*.json` (new catalog, add-only), app-shell nav if needed (add-only line)
   - Skills: react-best-practices (render factories, keys, derive-don't-store, conditional rendering), next-best-practices (RSC entry thin, client leaf only), react-testing-library (N/A — no tests), ui-frontend-architecture (route composes feature), security (A05 plain-text model output, no remote content), typescript-expert.

### Optional Implementer S3 — ONLY if S2 scope is too large (droppable Phase 3 slice)
13. [client] Configure run screen (AC-7..AC-10) + the "1 vs N" block if split out (AC-51). Isolated route; state minimum v1 (PR selector, per-agent prior-verdict line + estimate, Select all, guarded run button). Owns only its own route files + add-only message lines.
    - AC refs: AC-7, AC-8, AC-9, AC-10, AC-51
    - Files: `client/src/app/multi-agent/configure/**` (new, disjoint from S2's results route)
    - Skills: same as S2.

**File-ownership order:** S1 (server + shared + migration) must land first and be merged/available before S2 starts (S2 imports the new contracts and routes). S3, if used, is disjoint from S2 (different route folder) and may run in parallel with S2 or be dropped.

## Minimum-v1 cut line (spec "Implementation phasing")
- **Phase 1 (must ship):** S1 steps 1-7,9 (contracts, migration, executor concurrency, start+results routes with columns/groups/conflicts, `schema_version`) + S2 steps 10-12 picker + results page (Columns/Tabs) + drawer wiring + SSE dedupe-by-seq in the drawer's `useRunEvents`.
- **Phase 2:** estimate endpoint + footer (step 8, AC-11..AC-16).
- **Phase 3 (droppable from v1):** Configure run screen (AC-7..AC-10) + "1 vs N" block (AC-51) = Implementer S3. May be cut without breaking phases 1-2.

## Skill roster for implementer
| Skill | Applies to steps | Key rule to respect |
|-------|------------------|---------------------|
| onion-architecture | 3-9 | route no `drizzle-orm`/`db`; SQL in persistence; use-case owns tx + narrow ports; domain pure; no barrel in `index.ts` |
| fastify-best-practices | 5,6,9 | schema-first validation, per-route rate limit (5/min), thin handlers |
| drizzle-orm-patterns | 3,5,6,8 | FK via arrow fn, index FK col, typed operators not bare Date |
| postgresql-table-design | 3,8 | nullable add-only FK, manual FK index, `source='local'` filter |
| zod | 1,2,9 | export schema+type, enums for verdict/status/state, non-empty array validation, literal+default for schema_version |
| typescript-expert | all | strict types, infer from Zod, no `any` |
| security | 9,11,12 | A01 workspace 403 boundary; A05 input validation + plain-text model output, no remote content |
| ui-frontend-architecture | 10-13 | feature-slice ownership, route composes feature, no peer-feature imports |
| react-best-practices | 10-13 | derive-don't-store, no render factories, stable keys, hooks for fetch |
| next-best-practices | 10-13 | RSC entry thin, `'use client'` only on interactive leaf |
| react-testing-library | — | not used (no tests in this workflow) |
| engineering-insights | 3,5,8 | short FK name; Drizzle typed-operator Date gotcha |

## Fix-loop cap (hard limit)
**Total agent budget for this feature:** ≤3 `implementer` (S1, S2, optional S3) + 1 `architecture-reviewer` + 1 `plan-verifier` + ≤2 fix agents.
- Review chain: `architecture-reviewer`, then `plan-verifier`. `security-reviewer` only if a concrete justified reason appears (e.g. a new raw-content store or auth bypass surfaces) — otherwise skipped.
- Fix loop: **at most 2 iterations AND at most 2 fix subagents total** (`implementer`, one narrow fix each) across the whole loop. After 2 fix agents or 2 iterations, remaining findings are REPORTED to the user, not looped.
- Implementers run `pnpm typecheck` and existing `pnpm test` to confirm nothing broke. They DO NOT write or modify test files.

## AC → plan-step traceability (for plan-verifier)
- AC-1..6 → S11 · AC-7..10 → S13 (Phase 3) · AC-11..14 → S8 · AC-12/15/16 → S12 footer + S4 concurrency · AC-17..19 → S3,S5,S6 · AC-20 → S1,S6 · AC-21 → S9 · AC-22..28 → S7 · AC-29..34 → S7,S12 · AC-35..39 → S12,S6 · AC-40..47 → S12 · AC-48..52 → S6,S12 · AC-53/54 → S9 · AC-55 → S2 · AC-56..58 → S6,S12 (no new raw store; plain text).
- Coverage self-check: every step maps to ≥1 AC; every AC-1..58 maps to ≥1 step. No orphan step, no uncovered AC. (AC-56/58 are "no new store" guarantees satisfied by read-only compute in S6 + plain-text render in S12, not a dedicated step.)

## Verified code anchors (requirement 8)
- **Finding→run link:** `findings.reviewId` → `reviews.id`; `reviews.runId` → `agent_runs.id` (`server/src/db/schema/reviews.ts:19,30`). No direct finding→run column; join via reviews.
- **Active-runs query (409 guard):** `activeRunsForPull(workspaceId, prId)` filters `agent_runs.status='running'` (`run.repo.ts:10,27-28`). Rows start in `'running'` (`run.repo.ts:158`). Reuse it for the 409; it does NOT cover a `'queued'` state (none exists today).
- **agent_runs exposure for estimate:** run repository already selects over `agent_runs` (`createAgentRun` 140, `completeAgentRun` 165, `listRunsForPull` 53, `activeRunsForPull` 10); add one aggregation query filtering `status='done'` AND `source='local'`, last 5 per agent, workspace-wide. `createAgentRun` already sets `source:'local'` (`run.repo.ts:159`).
- **Trace drawer reuse:** `RunTraceDrawer` mounted from `?trace=<runId>` at `client/src/features/pull-detail/ui/PullDetailScreen.tsx:62`; reused unchanged (AC-38, D7).

## Risks / open questions
- **409 guard vs queued:** `activeRunsForPull` only matches `'running'`. Today rows are created `'running'` so it is correct; if a future `'queued'` state is added the guard must widen. Not a blocker.
- **D7 SSE dedupe location:** `useRunEvents` (`client/.../reviews/api/hooks.ts:23`) must dedupe by `seq` in the drawer; confirm it already does or add client-side dedupe (no server change). Low risk.
- **Reply-to-author (AC-45 / spec "open"):** rendered disabled per D10 — resolved; no GitHub write wired.
- No AC is left without a step and no step lacks an AC (see traceability). No spec gap blocks implementation.

## Explicit non-goals
- No parallel-execution engine rewrite; only the executor loop gets `concurrency` (reuse per D2). `runOneAgent` and isolation untouched.
- `ci/`, `eval-ci.ts`, `agent-runner/`, `agent_runs.source='ci'` path — NOT touched (owned by sibling worktree `feat-export-to-ci`; shared files get add-only lines; migration regenerated with `pnpm db:generate` by whoever merges second).
- No change to `RunReviewDropdown` single-agent/"Run all" behavior, `RunRequest`, `POST /pulls/:id/review`, `reviews`/`findings` schemas, grounding gate, or `reviewer-core` (D1; spec non-goals).
- No GitHub posting, no MCP exposure, no Persistent Memory/Curator, no Per-Agent Stats.
- No tests authored or modified in this workflow; test-based NFRs deferred (checklist below).
- **No specification was authored or modified** — the spec is input only.

## Deferred tests (checklist only — NOT part of this workflow)
Spec NFRs to be covered later by a separate test pass:
- [ ] Failure isolation: results with one `failed` + others `done` (AC-39).
- [ ] No new raw-content store: payloads carry only ids/counts/severities/titles/rationales/notes (AC-56, AC-58).
- [ ] Telemetry versioning: `schema_version` present and matches schema (AC-55) — contract test.
- [ ] Access: cross-workspace start/results/estimate → 403 (AC-53, AC-21) — integration test.
- [ ] Input validation: empty/non-workspace/>6 agent set → 422 (AC-54) — route test.
- [ ] Output safety: disagree note with `<script>` renders as plain text (AC-32, AC-57) — client test.
- [ ] Grouping determinism: fixed finding set → stable groups/conflicts (AC-22, AC-28) — unit test.
- [ ] Cost honesty: sum excludes null `cost_usd` (AC-49, AC-52) — unit test.
- [ ] i18n: strings from catalog (NFR).
