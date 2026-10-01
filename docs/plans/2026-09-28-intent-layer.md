# Development Plan: Intent Layer (PR intent classifier → review injection → UI)

**Date:** 2026-09-28
**Modules affected:** shared contracts (`server/src/vendor/shared`), server (`reviews` module, `settings`, DB), reviewer-core, client.
**Status:** approved by the user; implemented.

## Objective
Determine the motivation of a PR (title, description, linked issue, linked plan/spec, file list with hunk headers) with a separate cheap flash-class model, persist it per PR, inject the structured intent into the reviewer prompt, filter out-of-scope review comments deterministically, and show an intent card before the review results.

## Decisions (confirmed by the user)
1. Out-of-scope findings: dropped, except `CRITICAL` and `security`/`secret_leak` (kept untouched); other serious out-of-scope findings collapse into ONE `out_of_scope` signal.
2. API field is `summary`; the existing `pr_intent.intent` column is kept and mapped at the boundary.
3. Default classifier model: `deepseek/deepseek-v4-flash` via OpenRouter (feature id `review_intent`), selectable in Settings → Models.

## Data sources (classifier input; never full diff bodies)
| Source | Origin | Notes |
|---|---|---|
| Title, description | `pull_requests` | description untrusted, capped at 4000 chars |
| Linked issue/ticket | `github.getIssue()` from `#N` / issue URL in the description | |
| Plan / spec | in-repo links (`docs/plans/*.md`, `specs/*.md`, blob/raw URLs of the same repo) read via `git.readFile` at head | capped ~6000 chars each |
| External links (Notion, Jira, Google Docs…) | not fetched | recorded as `unresolved` + `missing_context` |
| Files + hunk headers | `diff.files[].hunks` (parser extended with `section`) | no `+`/`-` lines |
| Commit messages | `pr_commits` | indirect signal, used when the description is empty |

Empty description → title + file names + hunk headers (+ commits), `confidence: low`. Unavailable link → never invented; listed in `missing_context`. All text is passed through a secret redactor before it leaves the process or is logged.

## Call sequence
1. `POST /pulls/:id/review` → `executeRuns` → `loadDiff`.
2. `ensureIntent` (once per batch of agents): cache hit when `pr_intent.head_sha == pull.headSha`; otherwise gather sources → build prompt (reviewer-core, pure) → `llm.completeStructured` with `resolveFeatureModel('review_intent')` → `upsertIntent`. Failure is non-fatal (logged, review continues without intent).
3. Per agent: `reviewPullRequest({ …, intent })` → `## PR intent` section (untrusted-wrapped) → grounding → deterministic `applyIntentScope`.
4. `POST /pulls/:id/intent` re-derives (force) after the PR was updated.

## Steps
1. [shared] `Intent` gains `summary`, `confidence`, `sources[]`, `missing_context[]`; `PrIntentRecord` gains `stale`, `model`, `updated_at`; `Finding.scope` (optional); `FindingKind` gains `out_of_scope`; `PromptAssembly.intent`; `RunTrace.intent_call`.
2. [db] Additive migration `0014`: new columns on `pr_intent` (`confidence`, `sources`, `missing_context`, `provider`, `model`, `head_sha`, `tokens_in`, `tokens_out`, `cost_usd`, `updated_at`). Generated with drizzle-kit, applied manually.
3. [reviewer-core] `src/intent/prompt.ts` (classifier prompt builder), `src/intent/scope.ts` (`applyIntentScope`), `assemblePrompt` intent slot, `DiffHunk.section`.
4. [server] `reviews/intent/{redact,sources,service}.ts`; wiring in `run-executor.ts`; routes `GET|POST /pulls/:id/intent`; response schemas.
5. [settings] default of `review_intent` → OpenRouter flash model (server registry + client mirror).
6. [client] `IntentCard`, `usePrIntent` / `useRederiveIntent`, query keys, i18n strings, placement before review results.
7. [observability] two separate logged calls (intent classifier vs main review); log component sizes, model, token estimates, source identifiers; no secrets, no diff bodies, no prompt text.

## Testing strategy
- Unit: intent prompt builder (no `+`/`-` diff lines, plan/spec included, unresolved links flagged), redactor, `applyIntentScope`, `assemblePrompt` intent slot.
- Integration (`*.it.test.ts`): intent API, cache by `head_sha`, re-derive.
- Client: `IntentCard` rendering, stale badge, re-derive pending/error.
- Commands: `typecheck` and `test` in `server`, `client`, `reviewer-core`.

## Risks / open questions
- Prompt-injection: intent derives from untrusted text; scope filtering is deterministic and never hides CRITICAL/security findings (consistent with `INJECTION_GUARD`).
- Extending `Finding` changes structured output for all agents and the CI runner.
- External links stay unresolved → low confidence (expected).
- Do not touch: `.github/workflows`, lock files, existing migration history, `docker-compose.yml`, `turbo.json`.

## Prompt-assembly logging

Every LLM call (the intent classifier and each review chunk) emits one `[prompt]` log event
(`event: prompt.assembled`) with: `correlation_id` (one per review batch / re-derive, also stored in
`run_traces.config.correlation_id`), `call` (`intent` | `review`), `provider`/`model`, and per section
`{section, source, chars, tokens_est}` plus totals. Only names, identifiers and sizes are logged.

Local verbose mode: `DEVDIGEST_PROMPT_LOG_VERBOSE=true` with `NODE_ENV=development`. It adds a
stdout-only event with `sha256_12` (of the redacted text), line counts and a ≤160-char redacted
preview for the allowlisted sections `title`, `task`, `files`. Diffs, PR descriptions, issue/plan/spec
bodies, skills, callers and repo maps are never previewed. Outside development the flag is ignored
with a startup warning. Implementation: `server/src/platform/prompt-log.ts`.
