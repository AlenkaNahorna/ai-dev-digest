# MCP Module — @devdigest/mcp

Local **stdio MCP server** over the DevDigest HTTP API: five tools (`list_agents`, `run_agent_on_pr`, `get_findings`, `get_conventions`, `get_blast_radius`) so AI clients (Claude Code, Cursor, ...) can review PRs and read results. It is a **thin translation layer**: no business logic, no DB, no LLM call of its own. The DevDigest API (`DEVDIGEST_API_URL`, default `http://127.0.0.1:3001`) must be running; no credentials are sent (local no-auth provider).

> **Status:** partial · plan `docs/plans/2026-10-04-devdigest-mcp.md` steps 1-6 implemented; tests of steps 4-6 written but first run pending (`npm test`); step 7 (manual verification / evals) NOT done. Step 9 (real blast radius, `GET /pulls/:id/blast`) is done: see the dated amendment in the plan and `docs/plans/2026-10-04-blast-radius.md`.

## Stack

- **Language**: TypeScript, source-only (no build output), run with `tsx`
- **Protocol**: `@modelcontextprotocol/sdk` (installed 1.32.0), low-level `Server` + hand-written JSON Schema tool specs
- **Contracts**: Zod schemas from `../server/src/vendor/shared` via the `@devdigest/shared` path alias
- **Testing**: Vitest (hermetic; `fetch` stubbed), `js-tiktoken` for the token budget

## Commands

```bash
cd mcp
npm run typecheck   # tsc --noEmit (also the static check; no linter configured)
npm test            # vitest run (hermetic: no API, DB or LLM)
npm run dev         # tsx src/index.ts  (stdio server; talks JSON-RPC on stdout)
```

Environment: `DEVDIGEST_API_URL` (default `http://127.0.0.1:3001`), `DEVDIGEST_MCP_WAIT_MS` (blocking limit of `run_agent_on_pr`, integer 1000-600000, default 120000; invalid value = startup failure on stderr).

## Architecture (onion, mirrored from `server/`)

```
src/
  index.ts                     # entry: stdio transport, stderr logging, console.log redirected to stderr
  compose.ts                   # composition root: builds HTTP adapter, resolver, use cases, tools, server
  domain/                      # pure: shaping, caps, id matching, input validation, wait-budget parsing
  application/
    ports/devdigest-api.ts     # narrow DevDigestApi interface (Pick<> rows of shared contracts)
    use-cases/                 # one per tool + resolve.ts; no MCP SDK, no fetch
    errors.ts                  # HintError, ApiError, toHintMessage, guarded
  adapters/
    inbound/mcp/               # tool spec (name, description, JSON Schema, annotations) + Zod args; server.ts
    outbound/http/             # devdigest-api.ts (fetch + boundary schemas), wait-for-run.ts (SSE)
```

Dependency rules: `domain/` imports nothing outside itself; `application/` imports only `domain/` and its own ports (never the MCP SDK or `fetch`); adapters depend inward; only `compose.ts` (and `index.ts` for the transport) wire concrete implementations. Use cases receive the port/resolver, not a container.

## Key Rules

- **No barrel exports**: import each file directly.
- **Shared contracts via alias**: `@devdigest/shared` -> `../server/src/vendor/shared` (tsconfig `paths` + vitest alias). Never copy contracts; boundary schemas are `.pick()` of them.
- **stdout carries only JSON-RPC.** All diagnostics go to stderr (`log` in `index.ts`); `console.log`/`console.info` are redirected there. `test/stdout.test.ts` locks this.
- **Tool descriptions, parameter descriptions, server `instructions` are verbatim from the plan** ("Tool descriptions" section). `test/tools-list.test.ts` compares them to a golden payload.
- **Token budget**: serialized `tools/list` definitions + `instructions` <= 800 tokens (`cl100k_base`), enforced by `test/tools-list.test.ts`. Also: exactly 5 tools, descriptions <= 200 chars, flat scalar params only, no `outputSchema`/`title`, `readOnlyHint: true` on four tools and none on `run_agent_on_pr`.
- **Bounded output**: every response is capped (items + per-field length); see `specs/tools-contract.md`. Strings from the API are untrusted: flattened (`clipText`) and never interpolated into instructions.
- **Validate before URLs**: `repo` must match an anchored `owner/name` regex, `pr` a positive safe integer (sent as a digits-only string, a number is tolerated), ids are `encodeURIComponent`-ed.
- **Reads never run a review**: only `run_agent_on_pr` may cost money; it never starts a second run for an agent that already has one in flight.
- **No polling**: waiting for a run uses the SSE stream, not request loops (API global limit is 120 req/min shared with the web UI).

## Error-message conventions

Every message says what is wrong and what to do next. Expected, user-fixable problems throw `HintError` (message shown to the model verbatim). Transport/HTTP/contract failures throw `ApiError` from the outbound adapter and are mapped by `toHintMessage` (`application/errors.ts`). Anything else becomes a short generic message; the detail and stack go to stderr only. Never put a stack trace or raw API body into a tool result. Catalogue: `specs/tools-contract.md`.

## How to add a tool

1. Add the use case in `src/application/use-cases/<tool-name>.ts` (orchestration only; depend on `Pick<DevDigestApi, ...>` and `Resolver`); extend the port + `adapters/outbound/http/devdigest-api.ts` (boundary schema = `.pick()`) if a new endpoint is needed; put pure shaping/caps in `src/domain/`.
2. Add `src/adapters/inbound/mcp/<tool-name>.ts`: description constant, `ToolSpec` (flat scalar properties, each with a description), Zod args (reuse `arg-schemas.ts`), `defineTool(...)`.
3. Register it in `src/compose.ts`.
4. Write the description/params in the plan's "Tool descriptions" FIRST, then in code, then update the golden payload in `test/tools-list.test.ts` and re-check the 800-token budget.
5. Add hermetic tests (stubbed `fetch` or port doubles) and update `specs/tools-contract.md`.

## Key Files

- `src/compose.ts` — wiring; `src/adapters/inbound/mcp/define-tool.ts` — arg validation + guarded handler + compact JSON result
- `src/adapters/inbound/mcp/server.ts` — low-level `Server`, `tools/list` and `tools/call` handlers
- `src/adapters/outbound/http/devdigest-api.ts` / `wait-for-run.ts` — HTTP + SSE
- `src/application/use-cases/resolve.ts` — `owner/name`, PR number, agent id or name -> ids
- `src/domain/review-shape.ts` — newest review per agent, severity order, caps

## Do Not Touch

- **Tool descriptions, parameter descriptions, `instructions`** — do not edit in code without updating the plan's "Tool descriptions" first (plans are immutable records: add a dated amendment per the owner's process) and the golden test in the same change.
- **`server/src/vendor/shared`** — canonical contracts; never copy or edit from here.
- `.github/workflows/` — a CI workflow for `mcp/` does not exist and needs explicit owner approval (see root `AGENTS.md` Do Not Touch).
- Lock files — `mcp/package-lock.json` is not to be hand-edited.

## Related Documentation

### Read When

- Changing any tool input/output/error: [specs/tools-contract.md](specs/tools-contract.md)
- Why a design choice was made: [docs/plans/2026-10-04-devdigest-mcp.md](../docs/plans/2026-10-04-devdigest-mcp.md)
- API behaviour relied on: [server/AGENTS.md](../server/AGENTS.md)
- Test strategy: [TESTING.md](../TESTING.md); root rules: [AGENTS.md](../AGENTS.md)

## Session Protocol — MCP Module

**Before you start**: read `mcp/INSIGHTS.md` (and root/server insights for API behaviour) and summarize the top 3 relevant entries.

**End of session**: write insights only if substantial (non-obvious, actionable, not a duplicate; check `ENGINEERING-INSIGHTS.md`). Format: `- [YYYY-MM-DD] **Category**: Finding. Evidence: \`file:line\`.` Use the `engineering-insights` skill.
