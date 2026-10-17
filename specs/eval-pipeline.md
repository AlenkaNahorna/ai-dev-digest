# Spec: Eval Pipeline (regression protection for review agents)
Spec ID: SPEC-2026-10-16-eval-pipeline
Status: approved
Modules: server, client, shared contracts (`server/src/vendor/shared`)

> File name follows the course checklist (`specs/eval-pipeline.md`); the ID above follows `specs/README.md`.

## Problem and user
A DevDigest user edits a review agent (system prompt, model, linked skill) and has no way to tell whether
the agent got better or worse. The user's own accept/dismiss decisions on findings (L01–L05) already say what
a good review looks like, but they are thrown away after the click.

This spec turns those decisions into a regression set stored in Postgres next to the findings they come from:
- an **accepted** finding becomes a `must_find` case ("the agent must report something at `file:line`");
- a **dismissed** finding becomes a `must_not_flag` case ("the agent must not comment at `file:line`").

The user runs the agent on all its cases, sees recall / precision / citation accuracy computed **by code only
(no model call in scoring)**, keeps a history of runs and compares two runs side by side ("old prompt vs new").
The user is the person who owns and tunes review agents in the Skills Lab.

Baseline in the current code (analysis, not a change request):
- Tables `eval_cases` (`owner_kind`, `owner_id`, `name`, `input_diff`, `input_files`, `input_meta`,
  `expected_output`, `notes`) and `eval_runs` (`case_id`, `ran_at`, `actual_output`, `pass`, `recall`,
  `precision`, `citation_accuracy`, `duration_ms`, `cost_usd`) exist since `0000_init`. Nothing reads or writes them.
- Contracts `EvalCase`, `EvalRun`, `EvalPerTrace` (`knowledge.ts`) and `EvalCaseInput`, `EvalRunRecord`,
  `EvalDashboard` (`eval-ci.ts`) exist and have no consumer.
- `findings` has `accepted_at` / `dismissed_at`; `POST /findings/:id/(accept|dismiss)` sets them (mutually exclusive).
- `reviewPullRequest` (reviewer-core) takes a parsed diff, an injected LLM and returns grounded findings plus the
  findings dropped by the grounding gate. Agent config changes bump `agents.version` and snapshot into `agent_versions`.
- The client has no Evals tab content, no Eval Dashboard page and no "Turn into eval case" action.
- `evals/` at the repo root is a different harness (skill/agent evals judged by a model, run in CI). It is not touched.

## Goals / Non-goals
- Goals
  - G1. Create an eval case from a decided finding in one click on the finding, then Save in the seeded "New eval case" modal (AC-46..AC-50), both expectation kinds (AC-1..AC-9).
  - G2. List all cases of an agent (AC-10..AC-12).
  - G3. Run an agent on all its cases with fixed inputs and persist the run (AC-13..AC-21).
  - G4. Score by code: file match + line overlap; recall, precision, citation accuracy (AC-22..AC-29).
  - G5. Show runs: Evals tab in the agent editor, run history, compare two runs, Eval Dashboard page (AC-30..AC-41).
- Non-goals
  - Any model call in scoring or in matching (judge-free by design).
  - Skill evals (`owner_kind = 'skill'`), CI gating on eval results, scheduled runs.
  - Editing a case's diff or expectation by hand; the "Finding skeleton" JSON editor from the design.
  - Matching on title or rationale text; only `file` + line overlap count.
  - Touching the `evals/` harness, `.github/workflows/`, or existing migrations.

## User stories
- As an agent owner, I click "Turn into eval case" on an accepted finding, so that the agent is guarded against losing that catch.
- As an agent owner, I click it on a dismissed finding, so that the agent is guarded against bringing that noise back.
- As an agent owner, I change the system prompt, press "Run all evals" and see whether recall and precision moved.
- As an agent owner, I pick two runs and compare metrics, cost and the prompt text of both versions.

## Priorities
- P1: AC-1..AC-29, AC-30..AC-36, AC-40..AC-44, AC-46..AC-49, AC-51..AC-53.
- P2: Dashboard page and agent drill-down (AC-37..AC-39), import from decisions (AC-45), run on save (AC-50).

## Definitions
- **Case**: one row of `eval_cases` with `owner_kind = 'agent'`. Input = a unified-diff fragment (`input_diff`).
  Expectation = `expected_output` = `{ kind: 'must_find' | 'must_not_flag', file, start_line, end_line, title, severity, category }`.
- **Batch**: one execution of an agent on all its cases. Rows of `eval_runs` that share `batch_id`.
- **Emitted finding**: a finding the model produced for a case before the grounding gate. **Kept finding**: one that survived the gate.
- **Hit**: a kept finding whose `file` equals the expectation's `file` and whose `[start_line, end_line]` intersects the expectation's range.

## Acceptance criteria (EARS)

**Creating a case**
- AC-1 (event-driven): WHEN the user presses "Turn into eval case" on an accepted finding, the system shall create a case with expectation `must_find`.
- AC-2 (event-driven): WHEN the user presses it on a dismissed finding, the system shall create a case with expectation `must_not_flag`.
- AC-3 (ubiquitous): The expectation shall carry the finding's `file`, `start_line`, `end_line`, `title`, `severity` and `category`.
- AC-4 (ubiquitous): The case shall store a diff fragment: the unified diff of the finding's file restricted to the hunks that intersect the finding's lines (the whole file diff when no hunk intersects), taken from the PR diff at creation time.
- AC-5 (ubiquitous): The case shall belong to the agent that produced the finding (`owner_kind = 'agent'`, `owner_id` = the review's agent) and keep a reference to the source finding and PR in `input_meta`.
- AC-6 (unwanted behavior): IF the finding is neither accepted nor dismissed, THEN the system shall refuse with 422 `finding_undecided` and create nothing.
- AC-7 (unwanted behavior): IF a case already exists for the same finding, THEN the system shall answer 409 `eval_case_exists` and create nothing.
- AC-8 (unwanted behavior): IF the PR diff cannot be loaded or has no entry for the finding's file, THEN the system shall refuse with 409 `diff_unavailable` and create nothing.
- AC-9 (ubiquitous): Creating a case shall make no model call, and every route shall be workspace-scoped (a finding or agent of another workspace answers 404).

**Listing**
- AC-10 (ubiquitous): The system shall list the cases of an agent, newest first, each with name, expectation kind, `file:line`, severity and the pass/fail of its latest run (or "never run").
- AC-11 (state-driven): WHILE an agent has no cases, the Evals tab shall show an empty state that explains how to create one.
- AC-12 (event-driven): WHEN the user deletes a case, the system shall remove it and its run rows; history of other cases is unchanged.

**Running**
- AC-13 (event-driven): WHEN the user presses "Run all evals", the system shall run the agent once per case and store the results as one batch.
- AC-14 (ubiquitous): The inputs of a run shall be fixed: the agent's current system prompt, model, provider and linked skills, plus the case diff. No memory, project context, callers, repo map, PR description or intent shall be sent, so two batches differ only by agent configuration.
- AC-15 (ubiquitous): Each case shall be run in single-pass mode with the same fixed task line.
- AC-16 (unwanted behavior): IF the agent has no cases, THEN the system shall answer 422 `no_eval_cases` and make no model call.
- AC-17 (unwanted behavior): IF one case fails (model or parse error), THEN that case shall be stored as failed with the error text, the other cases shall still run, and the case shall count as a miss for recall and be left out of precision and citation accuracy.
- AC-18 (ubiquitous): Each batch row shall record `batch_id`, `agent_version`, `provider`, `model`, `duration_ms`, `cost_usd` and the actual output (emitted count, kept findings, dropped count, hits).
- AC-19 (ubiquitous): The system shall cap concurrent model calls of a batch at 2 and rate-limit the route.
- AC-20 (event-driven): WHEN a batch finishes, the response shall contain the batch summary and per-case results.
- AC-21 (unwanted behavior): IF a run is requested for an agent of another workspace, THEN the system shall answer 404.

**Scoring (pure code)**
- AC-22 (ubiquitous): Scoring shall be a pure function of (expectations, emitted and kept findings). It shall not import or call any LLM, provider, network or database code.
- AC-23 (ubiquitous): A finding matches an expectation when file paths are equal after normalizing a leading `./`, `a/`, `b/`, and the inclusive line ranges intersect.
- AC-24 (ubiquitous): A `must_find` case passes when at least one kept finding hits its expectation.
- AC-25 (ubiquitous): A `must_not_flag` case passes when no kept finding hits its expectation; each hitting finding is counted as noise.
- AC-26 (ubiquitous): `recall` = passed `must_find` cases / `must_find` cases of the batch (null when there are none).
- AC-27 (ubiquitous): `precision` = (kept findings − noise findings) / kept findings over all non-errored cases (null when no finding was kept).
- AC-28 (ubiquitous): `citation_accuracy` = kept findings / emitted findings over all non-errored cases (null when nothing was emitted).
- AC-29 (ubiquitous): Metrics are stored in [0,1]; the UI shows percentages and "—" for null.

**UI: agent editor**
- AC-30 (ubiquitous): The finding card shall show "Turn into eval case" for decided findings; success and each error of AC-6..AC-8 shall be shown as a toast.
- AC-31 (state-driven): WHILE the request is running, the button shall be disabled.
- AC-32 (ubiquitous): The Evals tab of the agent editor shall show the metrics of the latest batch with the delta to the previous one, the case list (AC-10) and a "Run all evals" button.
- AC-33 (state-driven): WHILE a batch runs, "Run all evals" shall be disabled and show progress state.
- AC-34 (ubiquitous): The Evals tab shall list the run history (time, version, recall, precision, citation, passed/total, cost), newest first.
- AC-35 (event-driven): WHEN the user selects exactly two runs and presses Compare, the system shall show metric deltas, cost delta, per-case pass changes, and the system prompt of both agent versions as a line diff.
- AC-36 (ubiquitous): Compare shall be disabled unless exactly two runs are selected.

**UI: Eval Dashboard**
- AC-37 (ubiquitous): The left sidebar (Skills Lab) shall contain "Eval Dashboard" linking to `/eval`.
- AC-38 (ubiquitous): `/eval` shall list every agent with its latest recall, precision, citation, passed/total and a trend, then the most recent batches of all agents (newest first).
- AC-39 (event-driven): WHEN the user opens an agent row, the system shall show its metric trend, run history and compare (same as AC-34..AC-36).

**Persistence and contracts**
- AC-40 (ubiquitous): New request/response shapes shall be Zod schemas in a new shared contract file; existing contract files shall not be edited; every route shall validate params and body with Zod.
- AC-41 (ubiquitous): Schema changes shall be one new migration (journal entry + snapshot); existing migrations shall not be edited.
- AC-42 (ubiquitous): `expected_output` shall be validated with Zod on write and on read; a row that fails validation shall be skipped with a warning in the log, not crash the list.

**Experiment and verification**
- AC-43 (ubiquitous): `pnpm verify:l06` shall pass only when: this spec and the plan exist; scoring has no LLM import; server and client typecheck, the architecture check and the eval tests pass; and, when Postgres is reachable, the database holds at least 8 cases with both expectation kinds.
- AC-44 (ubiquitous): A unit test shall prove sensitivity: the same cases scored with a "good" and a "degraded" stub model produce different recall/precision in the expected direction.
- AC-45 (event-driven, P2): WHEN the user presses "Import from decisions" in the Evals tab, the system shall create cases for every accepted/dismissed finding of the agent that has none yet, using the same rules as AC-1..AC-8, and report created / skipped counts.
- AC-46 (event-driven, P1): WHEN the user presses "Turn into eval case" on an accepted or dismissed finding, the system shall open the "New eval case" modal seeded from that finding (name, diff fragment, expectation JSON, case kind) WITHOUT storing anything and WITHOUT calling a model (`GET /findings/:id/eval-case-draft`); the refusals of AC-6..AC-8 apply already when opening.
- AC-47 (ubiquitous, P1): The modal shall let the user edit the name, the diff fragment and the expectation JSON, shall show whether the JSON is valid, shall offer "Finding skeleton" to restore the seeded JSON, and shall disable "Run case" and "Save" while the JSON is invalid.
- AC-48 (event-driven, P1): WHEN the user presses "Save", the system shall store the case with the user's edits (`POST /findings/:id/eval-case` with optional `name`, `expectation`, `input_diff`); fields left out keep the seeded value; AC-1..AC-9 otherwise apply.
- AC-49 (event-driven, P1): WHEN the user presses "Run case", the system shall run the agent once on the edited diff with the agent's fixed inputs (AC-14), score it in code (AC-22..AC-27), show pass/fail, counts, kept findings and cost in the "Actual output" panel, and shall NOT store a case or a run (`POST /agents/:id/eval-cases/try`, rate-limited).
- AC-50 (state-driven, P2): WHILE "Run on save" is on, pressing "Save" shall store the case and then perform the trial run of AC-49 and keep the modal open to show the result. The trial run is not added to the run history; the case gets its stored result on the next "Run all evals".
- AC-51 (ubiquitous, P1): Every case row in the Evals tab shall carry a kind label — "MUST FIND" for `must_find`, "MUST NOT FLAG" for `must_not_flag` — next to its name.
- AC-52 (event-driven, P1): WHEN the user presses "Run" on a case row, the system shall run the agent on that stored case only (fixed inputs, AC-14), score it in code, and show the result as the row's latest result (`POST /eval-cases/:id/run`); the run has no batch id, so run history, trends and the dashboard are not changed.
- AC-53 (event-driven, P1): WHEN the user presses "Edit" on a case row, the system shall open the same modal as AC-46 filled with the stored case; "Save changes" updates name, diff fragment and expectation (`PATCH /eval-cases/:id`), "Run case" is a trial run that stores nothing.
- AC-54 (ubiquitous, P2): A case row shall show the counts of its latest run (kept / on target / noise) or "never run", and the error text when that run failed.

## Inputs and provenance
Case input comes from `findings` → `reviews` (agent) → `pull_requests` (diff via the existing diff loader). Model output
is untrusted: findings are only compared as `(file, start_line, end_line)` numbers and rendered as plain text.

## Edge cases
- A finding of kind `secret_leak` / `lethal_trifecta` / `phantom` / `hook` is full-file; the fragment is the file's diff and the range stays the finding's range.
- Two findings on overlapping lines in a case count separately for precision and citation.
- Line numbers are new-side numbers, as in the grounding gate.
- A batch is stored even when every case failed (all `pass = false`, metrics null).
- Deleting an agent deletes its cases only if the cascade is added by the migration; otherwise cases of a deleted agent are hidden (unreachable by agent routes) — see Open questions.

### Skill evals (Skills page → Evals tab)
- AC-55: The skill detail page has an **Evals** tab listing the skill's hand-written cases with a MUST FIND / MUST NOT FLAG badge, header "Eval cases N/M passing · K cases", and per-row Run, Edit, Delete.
- AC-56: "New eval case" opens the same modal as for agents (nothing stored until Save); Run case shows two results, **With skill** and **Without skill**.
- AC-57: A skill case runs on the first enabled agent linked to the skill; with-skill carries only this skill's prompt text, without-skill has no skills. If no enabled agent is linked the API answers `skill_not_linked` and the UI says to link the skill first.
- AC-58: A skill row passes when it passes **with** the skill; the row shows "With skill X% / Without skill Y%". "Run all evals" runs every case on both sides (2 model calls per case). Skill runs keep no history and have no compare.
- AC-59: Scoring of both sides is the same code-only scoring as for agents (zero LLM calls for scoring).

## Non-functional requirements
- Security: all routes workspace-scoped; model text rendered as text; no secrets in `actual_output`.
- Cost: a batch costs one model call per case (+ retries); the dashboard reads stored rows only.
- Determinism: scoring is repeatable bit for bit for the same stored output.

## Open questions
- [NEEDS CLARIFICATION: skill versions are not snapshotted, so two batches that differ only by a skill edit show identical `agent_version`. Accept for this lesson?]
- [NEEDS CLARIFICATION: `eval_cases.owner_id` has no FK to `agents`; should the migration add `ON DELETE CASCADE` through a trigger, or leave orphans hidden?]
- Architecture impact: new module `modules/eval-pipeline` (onion layout) and new shared contract file `contracts/eval-pipeline.ts`; `docs/architecture.md` should list the module.
