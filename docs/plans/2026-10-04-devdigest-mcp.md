# Development Plan: `devdigest-mcp` — local MCP server over the DevDigest API (L04)
**Date:** 2026-10-04
**Modules affected:** new standalone package `mcp/` (`@devdigest/mcp`); docs at the repo root (`AGENTS.md`, `README.md`, `TESTING.md`). No changes to `server/`, `client/`, `reviewer-core/`, `e2e/`, the DB schema or migrations in this plan (the Blast Radius route is a follow-up, see step 9).

**INSIGHTS.md entries considered:**
- `server/INSIGHTS.md:[2026-09-23] Correctness` — finding rollups must use only the newest persisted review per agent; counting history double-counts after reruns. `get_findings` must apply the same rule.
- `server/INSIGHTS.md:[2026-09-21] Codebase Patterns` — reads never invoke reviewer-core or an LLM. `list_agents`, `get_findings`, `get_conventions` are pure `GET`s; only `run_agent_on_pr` may cost money.
- `ENGINEERING-INSIGHTS.md:[2026-09-27] Resource bounds` — user/LLM-authored content needs explicit size limits. Every tool response is capped (item count + per-field length).
- `ENGINEERING-INSIGHTS.md:[2026-09-28] CLARIFICATION` — `server/src/vendor/shared` is the only copy of the contracts; consume it through a tsconfig path alias, never copy it.
- `INSIGHTS.md` (root), `client/`, `reviewer-core/`, `e2e/` INSIGHTS: not relevant to this package.

**Architectural constraints:**
- Root `AGENTS.md` Key Rules: no barrel exports; path aliases only (no published packages); shared contracts are canonical in `server/src/vendor/shared`.
- Root `AGENTS.md` Do Not Touch: `.github/workflows/`, lock files of existing packages, `docker-compose.yml`, migration journal. A CI workflow for `mcp/` therefore needs explicit owner approval (step 8).
- `README.md`: packages are standalone (own `package.json` + lockfile, no workspace). `reviewer-core/` is the template: source-only TypeScript, `tsx`, vitest, alias `@devdigest/shared`.
- `server/AGENTS.md`: API on `:3001`; local no-auth provider resolves the default workspace, so the MCP server sends no credentials. Errors use the envelope `{ error: { code, message, details } }` (`server/src/platform/errors.ts`). `POST /pulls/:id/review` is rate-limited to 10/min.
- Decisions taken with the owner (2026-10-04): thin layer over HTTP (API must be running); new standalone package; `run_agent_on_pr` is BLOCKING with a 120 s limit; `get_conventions` returns ALL candidates of the latest scan; stdio transport, local only; `get_blast_radius` is a visible stub.
- `.claude/skills/onion-architecture/SKILL.md` is scoped to `server/`, but its dependency direction is mirrored in `mcp/` (see "Package layout"): thin inbound handlers, application use cases owning narrow ports, pure domain transformations, outbound HTTP adapter, one composition root, no barrel exports.
- `server/AGENTS.md` rate limiting: global 120 requests/min, `/runs/:id/events` (SSE) is exempt. Waiting for a run must not be implemented as tight polling.

## Objective
Expose DevDigest to AI clients (Claude Code, Claude Desktop, Cursor, Codex) through a local stdio MCP server with exactly five tools: `list_agents`, `run_agent_on_pr`, `get_findings`, `get_conventions`, `get_blast_radius` (stub). The server holds no business logic: it translates agent-friendly arguments into existing API calls and shrinks the responses. The whole `tools/list` payload must stay small (target ≤ 800 tokens) because Cursor-class clients load every definition on every request.

## Reality check: what the API already provides
| Tool | Existing endpoint(s) | Gap the MCP layer closes |
|---|---|---|
| `list_agents` | `GET /agents` | Response carries `system_prompt`, `output_schema`, model config — must be stripped to name + description. |
| `run_agent_on_pr` | `POST /pulls/:id/review {agentId}` | Fire-and-forget: returns `runs[].run_id` and `reviews: []` (`server/src/modules/reviews/service.ts:144-150`). The tool must wait and fetch the result itself. |
| `get_findings` | `GET /pulls/:id/reviews`, `GET /pulls/:id/runs` | Returns full history with long markdown `rationale`; must pick newest per agent and trim. |
| `get_conventions` | `GET /repos/:id/conventions` (L02) | Returns snippets and ids; must be trimmed. Empty before the first scan. |
| `get_blast_radius` | none (facade `repoIntel.getBlastRadius` exists, no route) | Stub now; route + wiring in step 9. |
| id resolution | `GET /repos`, `GET /repos/:id/pulls` | API speaks UUIDs; tools speak `owner/name` + PR number + agent name. |

## Tool contracts
Shared rules: flat scalar arguments only; identical names everywhere (`repo` = `"owner/name"`, `pr` = PR number, `agent` = agent name from `list_agents`); no `outputSchema`; responses are compact JSON text with only the fields below; server `instructions` is one line (`DevDigest PR review. Start with list_agents.`). Severity and verdict use the contract vocabulary (`CRITICAL|WARNING|SUGGESTION`, `approve|comment|request_changes`).

| Tool | Description (verbatim text: see "Tool descriptions") | Input | Output |
|---|---|---|---|
| `list_agents` (read-only) | `List the review agents configured in DevDigest. Call first to get a valid agent name.` | — | `{agents:[{name, description, enabled}]}`; description cut to 120 chars. |
| `run_agent_on_pr` (write) | `Run one review agent on a pull request and wait for the result (up to 2 min). Returns verdict and findings. Starts a paid LLM run.` | `repo: string`, `pr: integer`, `agent: string` | `{run_id, agent, verdict, score, counts:{critical,warning,suggestion}, findings:[{severity,file,line,title,why}], more}`; or `{run_id, status:"running", hint}` when the 120 s limit is reached. |
| `get_findings` (read-only) | `Read verdict and findings of reviews already run on a pull request. Does not start a review.` | `repo`, `pr`, `agent?: string`, `severity?: enum` | `{reviews:[<same review shape>]}` — newest review per agent (or only `agent`); `severity` keeps that level and above. |
| `get_conventions` (read-only) | `Get the house rules extracted from a repository (latest scan). Use before writing or reviewing code there.` | `repo`, `category?: enum(naming, structure, testing, error-handling, api-contract, other)` | `{scanned_at, conventions:[{category, rule, accepted, evidence:"path:line"}]}`; snippets and ids dropped. |
| `get_blast_radius` (read-only, stub) | `Show which symbols, callers and endpoints a pull request affects. Not implemented yet.` | `repo`, `pr` | `isError: true`, text `get_blast_radius is not implemented yet. Do not retry; continue without it.` Input is still validated. |

## Tool descriptions (VERBATIM — copy character for character)
The implementer must paste these strings exactly as written: no rewording, no added examples, no trailing text, no translation. A test (step 2) compares the registered strings with this section. If the evaluation in step 7 shows a wording problem, change the text HERE first, then in code, in the same commit.

Server `instructions`:
```
DevDigest PR review. Start with list_agents.
```

Tool descriptions:
```
list_agents
List the review agents configured in DevDigest. Call first to get a valid agent name.

run_agent_on_pr
Run one review agent on a pull request and wait for the result (up to 2 min). Returns verdict and findings. Starts a paid LLM run.

get_findings
Read verdict and findings of reviews already run on a pull request. Does not start a review.

get_conventions
Get the house rules extracted from a repository (latest scan). Use before writing or reviewing code there.

get_blast_radius
Show which symbols, callers and endpoints a pull request affects. Not implemented yet.
```

Parameter descriptions (the same string wherever the parameter appears):
| Parameter | Type | Used by | Description (verbatim) |
|---|---|---|---|
| `repo` | string | `run_agent_on_pr`, `get_findings`, `get_conventions`, `get_blast_radius` | `Repository as owner/name` |
| `pr` | integer | `run_agent_on_pr`, `get_findings`, `get_blast_radius` | `PR number` |
| `agent` (required) | string | `run_agent_on_pr` | `Agent name from list_agents` |
| `agent` (optional) | string | `get_findings` | `Only this agent (name from list_agents)` |
| `severity` (optional) | enum `CRITICAL`, `WARNING`, `SUGGESTION` | `get_findings` | `Minimum severity` |
| `category` (optional) | enum `naming`, `structure`, `testing`, `error-handling`, `api-contract`, `other` | `get_conventions` | `Only this category` |

Stub response text of `get_blast_radius` (verbatim):
```
get_blast_radius is not implemented yet. Do not retry; continue without it.
```

Findings are sorted by severity, capped at 10 per review (`more` = how many were cut), `why` = `rationale` cut to 300 chars, `suggestion` omitted.

Error messages always say what is wrong and what to do next:
- unknown agent → `Agent 'x' not found. Call list_agents for valid names.`
- repo not in DevDigest → `Repo 'o/r' is not added to DevDigest. Known repos: … Ask the user to add it in the DevDigest UI.`
- PR not imported → `PR #n is not imported for o/r. Ask the user to import pull requests in DevDigest.`
- no scan yet → `No conventions scan for o/r yet. Ask the user to run the Conventions extractor in DevDigest.`
- API down (connection refused) → `DevDigest API is not reachable at <url>. Ask the user to run ./scripts/dev.sh. Do not retry.`
- 429 → `Review rate limit reached (10/min). Wait a minute before calling run_agent_on_pr again.`
- run failed → `Run <id> failed: <error>. Call run_agent_on_pr again or pick another agent.`
- anything else → `DevDigest API error <code>: <message>` (never a stack trace).

## Package layout (onion direction mirrored from `server/`)
```
mcp/src/
  index.ts                         # composition root: builds the HTTP adapter, use cases, MCP server; stdio
  domain/                          # pure: review shaping (newest per agent, severity order, caps, trimming), id matching
  application/
    ports/devdigest-api.ts         # narrow interface the use cases need (listAgents, listRepos, listPulls, startReview, ...)
    use-cases/<tool-name>.ts       # one per tool; orchestration only; no MCP SDK, no fetch
    errors.ts                      # HintError (what is wrong + what to do next)
  adapters/
    inbound/mcp/<tool-name>.ts     # tool name, description, Zod input schema, annotations; calls one use case; maps result/HintError to MCP content
    outbound/http/devdigest-api.ts # implements the port with fetch + SSE; parses the API error envelope
```
Rules: `domain/` imports nothing outside itself; `application/` imports only `domain/` and its own ports (never the MCP SDK or `fetch`); adapters depend inward; only `index.ts` wires concrete implementations. Use cases receive the port, not a container.

## Steps
1. [mcp] Scaffold the package and register all five tools with their FINAL names, descriptions, input schemas and annotations; every handler returns "not implemented" — so the token budget is measured before any logic exists.
   - Files/areas: `mcp/package.json` (`@devdigest/mcp`, private, `type: module`, scripts `dev`/`typecheck`/`test`), `mcp/tsconfig.json` + `mcp/vitest.config.ts` (copy the `reviewer-core` alias setup for `@devdigest/shared`), `mcp/src/index.ts` (composition root + stdio), `mcp/src/adapters/inbound/mcp/<tool-name>.ts` (one file per tool), `mcp/.gitignore`. Follow "Package layout".
   - Dependencies: `@modelcontextprotocol/sdk`, `zod` (same major as the repo, `^3.24`); dev: `typescript`, `tsx`, `vitest`, `js-tiktoken`, `@types/node`. Verify at install time that the chosen SDK version accepts Zod 3 schemas and how it emits `outputSchema`/`title` — these details were not verified while planning.
   - Skills implementer should apply: `typescript-expert` — strict mode, no `any`; `zod` — schemas are the single source for types (`z.infer`), enums for closed sets; root `AGENTS.md` — no barrel exports (import each tool file directly from `index.ts`); `onion-architecture` — dependency direction as in "Package layout".

2. [mcp] Token-budget and contract tests.
   - Files/areas: `mcp/test/tools-list.test.ts` — connect an in-memory client, call `tools/list`, serialize definitions + `instructions`, count with `js-tiktoken`; fail above 800 tokens. Also assert: exactly 5 tools; every description ≤ 200 chars; no nested object/array parameters; no `outputSchema`; `readOnlyHint: true` on four tools and absent/false on `run_agent_on_pr`; snapshot of the full payload so any definition change shows up in the diff; the description strings, parameter descriptions and `instructions` equal the texts in "Tool descriptions" exactly.
   - `mcp/test/stdout.test.ts` — spawn the server over stdio and assert stdout carries only JSON-RPC (all logging goes to stderr).
   - Skills: `typescript-expert`; `TESTING.md` — hermetic by default, test behaviour at the seams.

3. [mcp] API client, id resolver and error mapping.
   - Files/areas: `mcp/src/application/ports/devdigest-api.ts` (the port), `mcp/src/adapters/outbound/http/devdigest-api.ts` (fetch wrapper: base URL from `DEVDIGEST_API_URL`, default `http://127.0.0.1:3001`; per-request timeout; parses the `{error:{code,message}}` envelope), `mcp/src/application/use-cases/resolve.ts` + pure matching in `mcp/src/domain/` (`repo` → repo id via `GET /repos` matching `full_name` case-insensitively; `pr` → pull id via `GET /repos/:id/pulls` matching `number`; `agent` → agent id via `GET /agents` matching `name` case-insensitively, ambiguous names listed in the error), `mcp/src/application/errors.ts` (`HintError` → `isError` tool result; a wrapper turns every other throw into a short generic message and logs the detail to stderr).
   - Validate API responses with `.pick()`-ed shared schemas (`Repo`, `PrMeta`, `Agent`, `ReviewRecord`, `ConventionCandidate`) so a contract drift fails loudly instead of producing garbage.
   - Skills: `zod` — `safeParse` at the boundary, never trust JSON; `security` — treat every string coming back from the API (PR titles, rationale, rules) as untrusted data, never interpolate it into instructions; validate `repo` with an anchored regex and `pr` as a positive integer before building URLs (no path injection).

4. [mcp] `list_agents` and `get_conventions`.
   - Files/areas: use case + inbound adapter per tool; pure trimming functions in `mcp/src/domain/`.
   - `get_conventions` returns all candidates of the latest scan (owner decision), keeps the `accepted` flag, optional `category` filter, cap 50 rules with `more`.
   - Skills: `zod` — `ConventionCategory` enum reused from the shared contract; `engineering-insights` Resource bounds.

5. [mcp] `get_findings`.
   - Files/areas: `application/use-cases/get-findings.ts`, `adapters/inbound/mcp/get-findings.ts`, `domain/review-shape.ts`.
   - `GET /pulls/:id/reviews` → keep `kind === 'review'`, newest per agent, optional `agent` and `severity` filters, trimmed finding shape. No reviews → hint to call `run_agent_on_pr`.
   - Skills: `server/INSIGHTS.md` 2026-09-23 (newest per agent); pure functions unit-tested without network.

6. [mcp] `run_agent_on_pr` — blocking, 120 s limit.
   - Files/areas: `application/use-cases/run-agent-on-pr.ts`, `adapters/inbound/mcp/run-agent-on-pr.ts`, wait logic behind the port (`waitForRun`) in `adapters/outbound/http/`.
   - Flow: resolve ids → if `GET /pulls/:id/runs/active` already has a run for this agent, attach to it instead of starting (and paying for) a second one → else `POST /pulls/:id/review {agentId}` → wait for completion on the SSE stream `GET /runs/:id/events` (rate-limit exempt, replays, ends on done) → then one `GET /pulls/:id/reviews` (review with that `run_id`) and, if it is missing, one `GET /pulls/:id/runs` to read `status` + `error` (`RunSummary`, `run.repo.ts:53-75`).
   - Do NOT poll every 2 s: two requests per tick for 120 s is ~120 requests and would exhaust the API's global 120/min limit shared with the web UI. If SSE proves awkward, fall back to one request every 5 s.
   - Limit: `DEVDIGEST_MCP_WAIT_MS`, default 120 000 (owner decision). On limit return `{run_id, status:"running", hint:"Still running. Call get_findings for this PR in ~30s."}` — the run keeps going in the API process. Client tool-call timeouts must be ≥ 120 s (check per client in step 7).
   - Skills: `security` — this is the only tool with side effects and cost; `typescript-expert` — `AbortSignal` for cancellation.

7. [mcp] Client configuration, manual verification and evaluation.
   - Files/areas: `.mcp.json` at the repo root (Claude Code, project scope), `.cursor/mcp.json` (Cursor), a documented snippet for Claude Desktop and Codex in `mcp/README.md`; command `npx tsx <repo>/mcp/src/index.ts` with `DEVDIGEST_API_URL`. Exact config syntax per client must be checked against current client docs.
   - MCP Inspector checklist: schemas, annotations, each error message, response sizes on the seeded PR (`acme/payments-api` #482).
   - `mcp/evals/tasks.md`: 8–10 real prompts run through an actual client (review a PR with the security agent; ask for naming conventions; unknown agent name; API stopped; blast radius requested → one call, no retry). Record call count and mistakes; fix confusion by editing error hints and, if needed, descriptions — a description change is made in "Tool descriptions" of this plan first, then in code — then re-run step 2.

8. [docs] Package and repo documentation.
   - Files/areas: `mcp/AGENTS.md` (+ `CLAUDE.md` symlink, as in other packages), `mcp/README.md`, `mcp/INSIGHTS.md`, `mcp/specs/tools-contract.md`; add the package to the tables in root `AGENTS.md`, `README.md` and the suite map in `TESTING.md`.
   - Optional, needs owner approval because `.github/workflows/` is Do Not Touch: `mcp.yml` modelled on `reviewer-core.yml` (typecheck + test, path filter `mcp/**` and `server/src/vendor/shared/**`).
   - Skills: `mermaid-diagram` for the one architecture diagram; end the session with `engineering-insights`.

9. [server + mcp] FOLLOW-UP (homework, separate plan): real `get_blast_radius`.
   - Add a read-only route (e.g. `GET /pulls/:id/blast`) that calls `repoIntel.getBlastRadius(repoId, changedFiles)` and returns the existing `BlastRadius` contract (`server/src/vendor/shared/contracts/brief.ts:78`); then replace the stub body. The tool's input schema does not change.

## Skill roster for implementer
| Skill | Applies to steps | Key rule to respect |
|-------|-------------------|----------------------|
| `typescript-expert` | 1–6 | strict types, no `any`, source-only package like `reviewer-core` |
| `zod` | 1, 3–6 | schemas as source of truth; `safeParse` at boundaries; enums for closed sets |
| `security` | 3, 6 | untrusted API strings are data; validate inputs before building URLs; one write tool |
| `engineering-insights` | 4–6, 8 | bounded outputs; capture learnings at session end |
| `mermaid-diagram` | 8 | diagram syntax for docs |
| `pr-self-review` | before PR | mandatory review of the diff |
| `onion-architecture`, `fastify-best-practices` | 9 only | thin handler, Zod `params`, workspace-scoped read |

## Testing strategy
- Existing tests covering this area: none (new package). API behaviour relied upon is covered by `server/test/reviews.it.test.ts`, `server/test/routes-smoke.test.ts`.
- New tests (all hermetic, `fetch` stubbed — no API, DB or LLM): `tools-list.test.ts` (budget + contract + snapshot), `stdout.test.ts`, `resolve.test.ts` (repo/pr/agent lookup and every "not found" hint), `shape.test.ts` (trimming, sorting, caps, newest-per-agent), `run-agent-on-pr.test.ts` (finishes in time / budget exhausted / run failed / attach to active run / 429), `errors.test.ts` (connection refused, envelope mapping, no stack traces).
- Commands to run: `cd mcp && npm run typecheck && npm test`. Manual: MCP Inspector + the eval prompts with `./scripts/dev.sh` running.

## Risks / open questions
- Client tool-call timeouts differ; a client that cuts calls before 120 s will show a failed call although the run continues. Verify per client in step 7 and document the setting.
- `run_id` alone cannot be resolved to a PR over the current API, so `get_findings` is keyed by `repo` + `pr` (optionally `agent`) rather than by `run_id`. If the course requires lookup by run, a small server route is needed.
- MCP SDK specifics (Zod 3 support, auto-generated `outputSchema`/`title` noise) are unverified; if the high-level API cannot produce a lean payload, register tools with hand-written JSON Schemas.
- `js-tiktoken` only approximates other clients' tokenizers; keep ~15% headroom under the 800 budget.
- Agent names are editable and not guaranteed unique; ambiguity is reported, not guessed.
- The stub costs ~60 tokens per request and may tempt a model to call it; the "do not retry" text and the eval prompt cover this.
- Package manager for `mcp/`: npm (like `reviewer-core`, `e2e`) is assumed; pnpm is equally valid.

## Explicit non-goals
- No remote/HTTP transport, no auth, no multi-workspace support.
- No new business logic, DB tables or migrations; no changes to `reviewer-core`.
- No tool for triggering the conventions extractor, importing repos/PRs, or accepting/dismissing findings.
- No edits to `.github/workflows/` without approval; no edits to existing lock files.
- Real Blast Radius (step 9) is planned separately.
