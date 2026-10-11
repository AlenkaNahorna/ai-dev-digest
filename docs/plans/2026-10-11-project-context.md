# Implementation Plan: Project Context (view-only repo docs attached to agents/skills)

- **Spec:** `specs/SPEC-01-project-context.md` (status: approved, 48 ACs)
- **Branch:** `feature/L05-spec-driven-development` (no additional branches)
- **Execution mode:** multi-agent — implementer → (architecture-reviewer ‖ security-reviewer ‖ plan-verifier) → test-writer (run separately; `implement-plan` skips it by default) → pr-self-review (merge verdict)
- **Modules affected:** `server` (new module `project-context`, run-executor, container, config, DB), `reviewer-core` (prompt helper), `server/src/vendor/shared` (canonical contracts; `client/src/vendor/shared` is a symlink), `client`
- **Insights considered:** shared contracts new fields must be `.nullish()`/optional; migrations append-only via `pnpm db:generate`; no barrel exports; `@devdigest/shared` alias only.

## Objective
Discover `.md` files under configurable roots (`specs`, `docs`, `insights`) in the synced default-branch clone, show them view-only on a Project Context page, let users attach paths (not text) to an agent and to a skill (per repo, ordered, persisted), and at run start inject the effective set into the prompt as an untrusted `## Project context` block with no extra LLM call. Trace records `specs_read` paths, per-doc and block tokens, and the exact text sent — including for failed/cancelled runs. Warning (no truncation) at 100,000 tokens.

## Recommendations (decisions taken — simplest option)
1. **Root-name matching, not glob** — no glob dependency (lockfiles must not change). Config is folder names `PROJECT_CONTEXT_ROOTS=specs,docs,insights`.
2. **View-only** — the clone is a `reset --hard` mirror; edits would be lost.
3. **`container.projectContext` facade** (lazy getter + `ContainerOverrides`) so `run-executor` consumes the module via the composition root, not by deep import.
4. **Symlinks skipped** during walk; reads go through `GitClient.readFile` (traversal + realpath protection).
5. **`renderSpecsBlock` helper exported from reviewer-core** so failure traces hold the exact text; harden `wrapUntrusted` to case-insensitive `/<\/untrusted\s*>/gi`.
6. **Refresh** = existing `POST /repos/:id/resync` + list refetch.
7. **Safe preview**: opt-in prop on vendored `Markdown` that renders images as alt text and blocks remote content; no raw HTML (react-markdown without rehype-raw already).
8. **Attachments do not version skills/agents** (spec decision).

## Reality check
| Item | Status | Consequence |
|---|---|---|
| `reviewPullRequest` input `specs?: string[]`, `assemblePrompt` renders `## Project context`, `prompt_assembly.specs` | exists | only wiring + helper extraction |
| `RunTrace.specs_read: string[]` | exists, always `[]` in run-executor (~L332, ~L483) | fill it; add nullish `specs_detail`, `specs_block_tokens` |
| Failure trace `traceFromBuffer` writes `specs: null` | exists | hoist resolved context like `promptSkills`, persist on failure |
| `GET /repos/:id/context`, `POST /repos/:id/context/reindex` (client dead hooks `useContextFiles`, `useReindexContext`) | server endpoint missing | build GET; delete reindex hook |
| `code_chunks` table | nothing writes it | **Resolved (user-confirmed):** footer label "chunks" is replaced by **"tokens total"** = sum of server-computed tokens of all discovered docs; `code_chunks` is not read. Spec AC-12 still says "chunks" → needs a spec-creator amendment (plan does not edit specs) |
| `container.tokenizer` | exists (cl100k, chars/4 fallback) | reuse; update header comment (no longer repo-intel only) |
| Nav item for `/context` | `activeKeyFor` maps it, NAV lacks item | add to `vendor/ui/nav.ts` (no gKey) |
| Migrations journal ends at `0015_intent_input_hash` | — | generate `0016_*` |

## Steps
### 1. Shared contracts (`server/src/vendor/shared/contracts/`)
- `platform.ts`: extend `SpecFile` with nullish `type`, `tokens`, `used_by_agents`; add `ProjectContextList` envelope `{roots, warn_tokens, tokens_total, files, index}`, `ContextDocBody`, `ContextAttachments` (`{repo_id, docs:[{path,order}]}`, + `missing` flag on read).
- `trace.ts`: add nullish `specs_detail: [{path,tokens}]`, `specs_block_tokens`.
- Register in `responseSchemas`; extend `contracts.test.ts`.
- Skills: zod, typescript-expert. Do NOT edit `client/src/vendor/shared` (symlink).

### 2. Config
- `server/src/platform/config.ts` + `server/.env.example`: `PROJECT_CONTEXT_ROOTS` (default `specs,docs,insights`), `PROJECT_CONTEXT_WARN_TOKENS` (default 100000). Skills: zod, fastify-best-practices. Security: A05, no secrets logged.

### 3. DB schema + migration
- New `server/src/db/schema/project-context.ts`: `agent_context_docs(agent_id, repo_id, path, order)` PK(agent_id, repo_id, path); `skill_context_docs(skill_id, repo_id, path, order)` PK likewise; FK indexes + `(repo_id, path)` index; TEXT, timestamptz via `now()`. Export from `schema.ts`.
- `pnpm db:generate` → `0016_*`. Never hand-edit the journal; no auto-migrate.
- Skills: drizzle-orm-patterns, postgresql-table-design.

### 4. Module `server/src/modules/project-context/` (onion)
- `domain/`: `effective-set.ts` (agent docs in order, then enabled linked skills' docs, dedupe first occurrence), `doc-type.ts` (type from root), `root-match.ts`.
- `application/ports/`: `DocScanner`, `DocReader`, `AttachmentsRepo`, `UsageRepo`, `Tokenizer`.
- `application/use-cases/`: `list-context`, `get-doc`, `get/put-agent-context`, `get/put-skill-context`, `resolve-for-run`, `count-usage` (factories `createX`, mirroring `blast`).
- `adapters/outbound/persistence/repository.ts` (workspace-scoped, transactional atomic replace); `adapters/outbound/providers/clone-scanner.ts` (walk via `container.git.clonePathFor`, skip symlinks and EXCLUDED dirs `node_modules,.git,.pnpm-store,dist,vendor,build,coverage,.next,out`; missing root tolerated; reads via `GitClient.readFile`).
- `adapters/inbound/http/routes.ts`: `GET /repos/:id/context`, `GET /repos/:id/context/doc?path=`, `GET|PUT /agents/:id/context`, `GET|PUT /skills/:id/context`. `getContext()` → 403; `IdParams` → 422; `NotFoundError` → 404; PUT body `superRefine` rejects duplicate paths/orders; invalid path (traversal, non-`.md`, outside roots) → 422.
- Register in `server/src/modules/index.ts`. Domain imports no outer layers; run `pnpm architecture:check`.
- Skills: onion-architecture, fastify-best-practices, zod, drizzle-orm-patterns. Security: A01 (workspace scoping on agent/skill/repo), path.join traversal.

### 5. Container facade
- `platform/container.ts`: lazy `projectContext` getter + `ContainerOverrides.projectContext`.

### 6. Run wiring (`run-executor.ts`, `reviewer-core`)
- reviewer-core `prompt.ts`: extract/export `renderSpecsBlock` (identical output), case-insensitive delimiter neutralization; tests in `reviewer-core/test/prompt.test.ts`.
- `runOneAgent`: after skills, `container.projectContext.resolveForRun(agent.id, repo)`; skip+warn (path only, no text) unreadable/empty/non-UTF-8/missing; single read snapshot; pass `specs` as `### <path>\n\n<text>`; set `specs_read`, `specs_detail`, `specs_block_tokens`; hoist for `traceFromBuffer` so failed/cancelled runs persist; per-agent in multi-agent; LLM call count unchanged; omit block when empty.

### 7. Client
- Nav item in `vendor/ui/nav.ts`; thin `app/context/page.tsx`; slice `features/project-context/{api,model,ui}` with query keys in `shared/api/query-keys.ts` (list, doc, agent/skill attachments).
- Selection UX goal (user): while choosing docs in the agent/skill Context tab, each row shows its tokens and the header shows the attached total ("≈ N tokens at run", warning at 100K) so the user sees the review-run cost before saving.
- Page: list, Markdown preview (safe), empty state naming roots, error + retry, footer (indexed files / **tokens total** / last index / "Used by N agents"), Refresh via resync. Add `tokens_total` (nullish) to the list envelope in step 1; no `code_chunks` count.
- Shared `ContextAttachmentList`: checkbox, path, type badge, Preview, "N of M attached", filter, reorder with move up/down buttons (keyboard) + drag, missing rows flagged + removable, pending/error feedback, "≈ tokens" total with warning at `warn_tokens`.
- Agent `ContextTab` (new `_components/ContextTab`, add to `constants.ts` TABS); skills page "Context" tab with "Serializes as" `## Project specifications` + paths.
- Trace UI: rename `runs.json` `trace.prompt.specs` → "Project context — attached specs (untrusted)", per-doc and block tokens in Configuration; row hidden when none.
- i18n: `messages/en/context.json` (fix stale `.devdigest/specs/` copy), `agents.json`, `runs.json`. Remove dead hooks in `features/pulls/api/hooks.ts`.
- Skills: ui-frontend-architecture, next-best-practices, react-best-practices, react-testing-library, typescript-expert. Security: A05 (no raw HTML, `javascript:` URLs, remote images).

### 8. Docs
- `docs/architecture.md` note (new module, `specs_read` detail); INSIGHTS entry if non-obvious findings. No spec edits.

## Skill roster
| Step | Skills |
|---|---|
| 1 | zod, typescript-expert |
| 2 | zod, fastify-best-practices |
| 3 | drizzle-orm-patterns, postgresql-table-design |
| 4–5 | onion-architecture, fastify-best-practices, zod, drizzle-orm-patterns, security |
| 6 | onion-architecture, typescript-expert, security (ASI01) |
| 7 | ui-frontend-architecture, next-best-practices, react-best-practices, react-testing-library |

## Testing strategy
- **Unit (hermetic):** effective-set merge/dedupe/order; doc-type; root matching; scanner with tmpdir (symlink escape, excluded dirs, missing root); tokenization; use cases with fake ports; PUT schema duplicates; prompt with `</untrusted>`/`</UNTRUSTED >` in doc; run-executor resolution, skip warnings, LLM call count unchanged; contracts.
- **Integration (`*.it.test.ts`, Testcontainers):** attachments CRUD + atomic replace; workspace isolation (403/404); `used_by_agents` with enabled/disabled skill links; trace persistence incl. failed run; `overrides.git` with tmpdir clone.
- **Client (RTL, `userEvent`, `getByRole`):** list/preview/empty/error+retry; attach toggle/reorder/filter/missing/pending-error; token total + warning at 100K; safe preview with `<script>` and remote image; trace row label/expand/copy/hidden-when-empty.
- **Commands:** `cd server && pnpm architecture:check && pnpm typecheck && pnpm test && pnpm test:integration`; `cd client && pnpm typecheck && pnpm test`; `cd reviewer-core && pnpm test && pnpm typecheck`.
- **Manual acceptance:** attach an invariant doc ("`api/` must not import `db/`"), run a violating PR, verify `prompt_assembly` contains the block and the finding cites the doc.

## Risks / open questions
- **AC-12 wording:** spec says "chunks"; user decided "tokens total" instead. Implement per this plan; spec-creator must amend AC-12 (and the footer i18n key `chunks` → `tokensTotal`).
- Symlink skipping is stricter than AC-4.
- "Used by N" counts agents regardless of `agents.enabled`.
- Map-reduce re-assembles per chunk → project-context tokens multiplied; warn only (no truncation per spec).
- List-time tokenization (≤200 docs): add mtime-keyed cache only if p95 fails.
- Stale clone: content is "as last synced".
- Contract change kept backward-compatible (nullish).
- No e2e flow (demo repo has no real clone) → manual acceptance instead.

## Non-goals / Do-Not-Touch
No spec authored or modified; no extra branches; no edit/create/upload of docs, Coverage, auto-selection, retrieval, non-md, versioning; do not touch workflows, `turbo.json`, `docker-compose`, existing migration history, lock files.
