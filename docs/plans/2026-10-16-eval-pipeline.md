# Implementation Plan: Eval Pipeline (regression protection for review agents)
**Date:** 2026-10-16
**Modules affected:** server (new `eval-pipeline` module, schema + one migration, response wiring, module registry), shared contract (new `server/src/vendor/shared/contracts/eval-pipeline.ts`, barrel export), client (FindingCard action, Evals tab in AgentEditor, `/eval` pages, nav item, hooks, i18n), root (`package.json` + `scripts/verify-l06.mjs`). No `reviewer-core`, `mcp`, `e2e`, `.github/workflows/` or existing-migration changes.
**Requirements source:** `specs/eval-pipeline.md` (Status: draft; AC-1..AC-45). Read as input only.
**Constraints read:** root `AGENTS.md` (no barrels, Zod on every route, snake_case JSON, migrations append-only, `client/src/vendor/shared` is a symlink), `server/.dependency-cruiser.js` (domain imports nothing outward; application imports no `db|platform|adapters|vendor`/fastify/drizzle; HTTP adapters import no `db`), `onion-architecture` layout copied from `modules/pr-brief`.

## Reality check: where the task text and the repo differ
| Task says | Repo has | Decision |
|---|---|---|
| "create tables `eval_cases`, `eval_runs`; schema and Zod contracts are given" | Both tables exist since `0000_init` (+ `EvalCase`, `EvalRunRecord`, `EvalDashboard` contracts); `pnpm verify:l06` does not exist; no root `package.json` | Reuse both tables. One new migration adds only what is missing: `eval_cases.source_finding_id` (+ unique index per owner) and `eval_runs.{batch_id, agent_version, provider, model}` (+ index). Expectation lives in `expected_output` (Zod-validated). New contract file instead of editing `eval-ci.ts`. Add root `package.json` with scripts only. |
| Spec file `specs/eval-pipeline.md` | `specs/README.md` wants `SPEC-<date>-<slug>.md` | Follow the checklist path; Spec ID line inside keeps the convention. |
| Run "agent on all cases of the set" | `reviewPullRequest` works on one parsed diff | One call per case (fragment diff), concurrency 2, one `batch_id` per button press. |
| Inputs fixed so versions are comparable | Agent skills are resolved by `SkillsService.promptSkills` | Skills stay (they are a variable the user wants to test); memory, specs, callers, repo map, PR text, intent are never sent. |
| No Docker/Postgres where this was built | `*.it.test.ts` need Docker | Everything verifiable is unit-level with in-memory ports; DB gate in verify script runs only when Postgres is reachable. |

## Steps
1. **Contracts** `contracts/eval-pipeline.ts`: `EvalExpectationKind`, `EvalExpectation`, `EvalCaseRecord`, `EvalBatchSummary`, `EvalBatchCaseResult`, `EvalBatchDetail`, `EvalCompare`, `EvalOverview`; export from barrel index.
2. **Schema + migration**: edit `db/schema/eval.ts`; `drizzle-kit generate` → `0018_eval_pipeline.sql` + snapshot + journal.
3. **Domain (pure, no imports outward)**: `scoring.ts` (match, per-case, batch aggregate), `fragment.ts` (slice a file's hunks out of raw unified diff), `names.ts` (case name), `expectation.ts` (own types).
4. **Application**: ports (`EvalStorePort`, `FindingSourcePort`, `AgentRunnerPort`, `AgentConfigPort`) and use-cases: create-case, list-cases, delete-case, run-batch, list/get-batch, compare, overview, import-from-decisions.
5. **Adapters**: persistence repository (drizzle, workspace-scoped), finding/diff source (reuses `loadDiff`), agent runner (`reviewPullRequest` + `container.llm`), HTTP routes with Zod; register in `modules/index.ts`.
6. **Server tests** (hermetic): scoring, fragment, use-cases with in-memory ports, no-LLM guard, sensitivity (AC-44), contract parsing.
7. **Client**: hooks, `FindingCard` button, Evals tab, `/eval` and `/eval/[agentId]`, nav item, i18n, component tests.
8. **verify:l06**: `scripts/verify-l06.mjs` + root `package.json`.
9. **Docs**: module note in `server/AGENTS.md`/INSIGHTS only if substantial.

## Risks
- Fragment lines are new-side numbers; the grounding gate on the fragment uses the same numbers, so a hit stays valid (covered by a test).
- A model may emit zero findings for a clean fragment: precision becomes null, not 1; the UI shows "—".
- Skill edits do not bump `agent_version`; two batches may look identical in config (spec open question).
