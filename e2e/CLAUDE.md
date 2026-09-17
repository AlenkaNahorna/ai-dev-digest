# E2E Module — @devdigest/e2e

Deterministic browser end-to-end tests via **agent-browser** (Vercel's Rust + Chrome DevTools Protocol CLI). No Playwright, no LLM, no API key — flows are JSON lists of CLI commands, run in sequence against one shared browser session.

## Stack

- **Browser automation**: `agent-browser` (Vercel) — CLI-driven, deterministic, snapshot-safe
- **Flow definition**: `specs/*.flow.json` — JSON lists of `agent-browser` commands
- **Runner**: `run.ts` — Thin orchestration (parse flows, execute commands, collect results)
- **Test framework**: Vitest (framework only; real assertions are command exit codes)
- **Seeded data**: Demo repo `acme/payments-api`, PR #482, built-in agents

## Commands

- `npm install` — Install (including `agent-browser`)
- `npm test` — Run flows against dev stack (requires fresh seed)
- `npm run e2e:hermetic` — Isolated stack (Postgres + API + web on alternate ports, then teardown)

From repo root:
- `./scripts/e2e.sh` — Hermetic e2e (preferred; doesn't touch your dev DB)

## Architecture

### Flow definition (specs/NN-name.flow.json)

```jsonc
{
  "name": "Describe what the flow tests",
  "steps": [
    { "cmd": ["open", "{BASE}/"],          "label": "load root" },
    { "cmd": ["wait", "--url", "/pulls"],  "label": "redirect to PR list" },
    { "cmd": ["wait", "--text", "#482"],   "label": "seeded PR visible" }
  ]
}
```

### Syntax

- `{BASE}` — Replaced with `E2E_BASE_URL` env var (default `http://localhost:3000`)
- `cmd` — Array of `agent-browser` CLI args (passed verbatim)
- `label` — Human description (logged)
- `assert.stdoutIncludes` (optional) — Substring check on command output

### Determinism

**Only deterministic locators allowed**:
- `--url PATH` — URL pattern match (no AI)
- `--text TEXT` — DOM text search (no AI)
- `find role=… | text=… | label=…` — Accessible name search (no AI)
- **Never** `chat` command (no AI, no API keys, runs are stable)

## Flows (Specs)

| File | Coverage |
|------|----------|
| `01-app-boot.flow.json` | App boots, root redirects to seeded repo's PR list |
| `02-repo-pulls-detail.flow.json` | PR list → open PR #482 → detail route |
| `03-agents.flow.json` | Agents page renders seeded reviewers |
| `04-pr-findings.flow.json` | PR detail → seeded run verdict + findings + expand FindingCard |
| `05-pr-diff.flow.json` | PR detail → Files changed tab → diff viewer |
| `06-onboarding.flow.json` | Onboarding page → add-repo form renders |
| `07-settings.flow.json` | Settings pages render (API keys, models) |

## Running Tests

### Hermetic (recommended)

```bash
./scripts/e2e.sh
```

**What it does**:
1. Spins up isolated Postgres (`:5433`, ephemeral volume), API (`:3101`), web (`:3100`)
2. Seeds demo data (`acme/payments-api`, PR #482, agents)
3. Runs all flows
4. Tears down the stack

**Why**: Safe to run while your dev stack is up; never touches `devdigest_pgdata`.

### Against running stack

Only if your dev DB has *only* the seeded repo:

```bash
./scripts/dev.sh                   # Postgres + API + web (seeded)
cd e2e && npm install && npm test
```

⚠️ **Precondition**: Flows 02/04/05 follow the home redirect to the *first* repo, so they fail if other repos exist.

## Key Rules

- **No Playwright/Puppeteer**: Uses native Chrome DevTools Protocol only
- **No LLM calls**: Runs are key-free and deterministic (not used for assertions)
- **Seeded data only**: Flows never trigger model calls or modify real repos
- **Exit code is the assertion**: Command timeouts or failures exit non-zero; that's the test failure
- **Hermetic DB**: Use `scripts/e2e.sh` to avoid contaminating your dev DB

## Environment Variables

- `E2E_BASE_URL` — App URL (default `http://localhost:3000`)
- `AGENT_BROWSER_BIN` — `agent-browser` CLI path (default `agent-browser`)
- `E2E_STEP_TIMEOUT` — Command timeout in ms (default 60000)
- `E2E_PG_PORT`, `E2E_API_PORT`, `E2E_WEB_PORT` — Hermetic ports (5433, 3101, 3100)
- `E2E_PG_IMAGE` — Docker image (default `pgvector/pgvector:pg16`)

## Artifacts

Failure screenshots are saved to `e2e/test-results/` (git-ignored; uploaded as CI artifact).

## Related Documentation

- [Flow spec format](README.md) — Detailed syntax and examples
- [Running flows locally](README.md#run-locally) — Hermetic vs. dev stack
- [Agent browser docs](https://github.com/vercel-labs/agent-browser) — CLI reference
- [CI workflow](../.github/workflows/e2e-web.yml) — How e2e runs in CI
- [Testing strategy](../TESTING.md) — Unit vs. integration vs. e2e
- [Root CLAUDE.md](../CLAUDE.md) — Project structure

## Session Protocol — E2E Module

### 🟢 BEFORE You Start

**Read e2e/ENGINEERING-INSIGHTS.md** and summarize the top 3 entries relevant to your task:
- Adding a new flow? → Check "What Works" (seeded data, deterministic locators)
- Debugging a failing flow? → Check "Recurring Errors & Fixes" (timeout, wrong repo, port conflicts)
- Using hermetic runner? → Check "What Doesn't Work" (don't use `docker compose down -v`)
- Writing locators? → Check "Tool & Library Notes" (agent-browser CLI)

**Example**: "I'm adding a new flow for settings page. Top 3 relevant insights:
1. Only deterministic locators: --url, --text, find role=… (no AI chat command)
2. Flows read only seeded data (acme/payments-api); nothing modifies repos
3. Use hermetic runner to avoid polluting dev DB"

### 🔴 END OF SESSION

Write insights **only if substantial**. Check ENGINEERING-INSIGHTS.md first for duplicates.

**Common scenarios:**

✅ **Write**: "Flows 02/04/05 follow home redirect to first repo; fails if dev DB has multiple repos. Use hermetic runner."
❌ **Skip**: "Determinism is important" (obvious)

✅ **Write**: "agent-browser --url timeout default 60s; increase with E2E_STEP_TIMEOUT=120000 for slow pages"
❌ **Skip**: "Test your flows" (too vague)

## Lazy-Load Context

- **Skills**: `/engineering-insights`
- **Related modules**: See [client/CLAUDE.md](../client/CLAUDE.md) (UI being tested), [server/CLAUDE.md](../server/CLAUDE.md) (API consumer)
- **Module insights**: See `ENGINEERING-INSIGHTS.md` (append-only learnings from prior sessions)
