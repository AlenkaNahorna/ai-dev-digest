# `@devdigest/mcp` — DevDigest for AI clients

A local **stdio MCP server** that lets Claude Code, Claude Desktop, Cursor and Codex
use DevDigest: list review agents, run one on a pull request, read findings and house
conventions. It is a thin translation layer over the DevDigest HTTP API (no business
logic, no DB, no credentials). Design and decisions: `docs/plans/2026-10-04-devdigest-mcp.md`.

## Prerequisites

1. The API must be running (it listens on `:3001`):
   ```bash
   ./scripts/dev.sh            # Postgres + migrate + seed + API + web
   ```
2. Install this package's dependencies (own `package.json` and lockfile, no workspace):
   ```bash
   cd mcp && npm install
   ```
3. Node >= 22.

## Run standalone

```bash
cd mcp && npm run dev          # = tsx src/index.ts
```

It waits on stdin for JSON-RPC and logs `ready (API ..., run wait limit ... ms)` to
**stderr**. stdout carries protocol messages only, so running it by hand is only useful to
see that it starts (Ctrl-C to quit). To actually talk to it use the Inspector below or a client.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `DEVDIGEST_API_URL` | `http://127.0.0.1:3001` | Base URL of the DevDigest API. |
| `DEVDIGEST_MCP_WAIT_MS` | `120000` | How long `run_agent_on_pr` blocks waiting for the run. Integer, **1000-600000**. Anything else (or a typo) makes the server exit at startup with a message on stderr. At the limit the tool returns `{run_id, status:"running", hint}` and the run keeps going in the API. |

> **Why `127.0.0.1`, not `localhost`:** Node 22 resolves `localhost` to `::1` (IPv6) first, while the DevDigest API listens on IPv4 only. Any other dev server bound to `[::1]:3001` then answers instead (symptom: `DevDigest API error http_404: Not Found` on `list_agents`). Check with `lsof -nP -iTCP:3001 -sTCP:LISTEN`.


## Tools

Names, descriptions and annotations are copied from `src/adapters/inbound/mcp/*.ts`
(the plan's "Tool descriptions" section is the source of truth).

| Tool | Description | Arguments | `readOnlyHint` |
|---|---|---|---|
| `list_agents` | List the review agents configured in DevDigest. Call first to get a valid agent name. | none | yes |
| `run_agent_on_pr` | Run one review agent on a pull request and wait for the result (up to 2 min). Returns verdict and findings. Starts a paid LLM run. | `repo` (`owner/name`), `pr` (integer), `agent` (name) | **absent** |
| `get_findings` | Read verdict and findings of reviews already run on a pull request. Does not start a review. | `repo`, `pr`, `agent?`, `severity?` (`CRITICAL`/`WARNING`/`SUGGESTION`, minimum level) | yes |
| `get_conventions` | Get the house rules extracted from a repository (latest scan). Use before writing or reviewing code there. | `repo`, `category?` | yes |
| `get_blast_radius` | Show which symbols, callers and endpoints a pull request affects. Read-only, from the repo index; may be partial. | `repo`, `pr` | yes |

Server `instructions`: `DevDigest PR review. Start with list_agents.`

## Client configuration

All entries launch the server as `npm --silent --prefix <repo>/mcp run dev` instead of
`npx tsx mcp/src/index.ts`. Reason: `tsx` must run with `mcp/` as its working directory
(the `@devdigest/shared` path alias lives in `mcp/tsconfig.json`), `npx tsx` from the repo
root would not find the locally installed `tsx` and would try to download it, and none of
Claude Code / Cursor has a `cwd` field. `--silent` keeps npm's banner off stdout, which must
stay pure JSON-RPC. (Only the stdout-cleanliness of `npm --silent --prefix mcp run typecheck`
was checked from the authoring machine; the full client launch was not run.)

### Claude Code (project scope) — `.mcp.json` in the repo root, already committed

```json
{
  "mcpServers": {
    "devdigest": {
      "command": "npm",
      "args": ["--silent", "--prefix", "${CLAUDE_PROJECT_DIR:-.}/mcp", "run", "dev"],
      "env": {
        "DEVDIGEST_API_URL": "${DEVDIGEST_API_URL:-http://127.0.0.1:3001}",
        "DEVDIGEST_MCP_WAIT_MS": "${DEVDIGEST_MCP_WAIT_MS:-120000}"
      }
    }
  }
}
```

- `${VAR}` and `${VAR:-default}` are expanded in `command`, `args` and `env`. There is no
  `cwd` field. `CLAUDE_PROJECT_DIR` is set only in the *server's* environment, so expansion in
  `args` needs a default such as `:-.`; start Claude Code from the repo root so `.` is right.
- Claude Code asks you to approve project-scoped servers on first use (reset with
  `claude mcp reset-project-choices`).
- **Tool timeout:** `MCP_TOOL_TIMEOUT` (ms) is the wall-clock limit per call and by default is
  about 28 hours (effectively unlimited). A per-server `"timeout": <ms>` field overrides it
  (values below 1000 are ignored). Nothing needs changing for the 120 s default; if you
  want a safety net add e.g. `"timeout": 180000` to the server entry.
- Equivalent CLI form: `claude mcp add --transport stdio --env DEVDIGEST_API_URL=http://127.0.0.1:3001 devdigest -- npm --silent --prefix /abs/path/to/ai-dev-digest/mcp run dev`

### Cursor — `.cursor/mcp.json` in the repo root, already committed

```json
{
  "mcpServers": {
    "devdigest": {
      "command": "npm",
      "args": ["--silent", "--prefix", "${workspaceFolder}/mcp", "run", "dev"],
      "env": {
        "DEVDIGEST_API_URL": "http://127.0.0.1:3001",
        "DEVDIGEST_MCP_WAIT_MS": "120000"
      }
    }
  }
}
```

- Project file: `.cursor/mcp.json`; global: `~/.cursor/mcp.json`. Interpolation in
  `command`, `args`, `env`, `url`, `headers`: `${workspaceFolder}`, `${env:NAME}`, `${userHome}`,
  `${workspaceFolderBasename}`, `${pathSeparator}`. `cwd` is not documented. No `${VAR:-default}`
  form is documented, so the env values are literals here.
- **Tool timeout: not documented and not configurable in settings.** Not an official doc: Cursor staff
  on the forum (July 2026) say `tools/call` times out at about 60 s in the Agent Client
  Protocol / CLI ("no configurable setting for this right now") and about 60 minutes in the IDE.
  So in the Cursor CLI/ACP set `DEVDIGEST_MCP_WAIT_MS` to about `50000`; in the IDE the 120 s default is fine.

### Claude Desktop — `claude_desktop_config.json`

Location: macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows
`%APPDATA%\Claude\claude_desktop_config.json` (or Settings > Developer > Edit Config). Fully
quit and restart Desktop after editing. Paths must be absolute.

```json
{
  "mcpServers": {
    "devdigest": {
      "command": "npm",
      "args": ["--silent", "--prefix", "/ABSOLUTE/PATH/TO/ai-dev-digest/mcp", "run", "dev"],
      "env": {
        "DEVDIGEST_API_URL": "http://127.0.0.1:3001",
        "DEVDIGEST_MCP_WAIT_MS": "50000"
      }
    }
  }
}
```

- **Tool timeout: effectively 60 s, not configurable.** Not in the official docs: a Claude Code
  issue (reported May 2026, closed "not planned" Jul 2026) says the Desktop app cancels stdio
  tool calls at about 60 s and ignores `MCP_TOOL_TIMEOUT` and the per-server `timeout` field, with
  no workaround (progress notifications do not extend it). Therefore `DEVDIGEST_MCP_WAIT_MS` is set
  to `50000` above (below 60 s with a margin). A run that needs longer returns `status:"running"` and
  the model should call `get_findings` ~30 s later.
- Desktop starts the server with a minimal environment: if `npm` was installed through
  nvm/fnm it may not be on that `PATH`; use the absolute path from `which npm` as `command`.
  (This is a practical caution, not stated in the docs.)
- Logs: macOS `~/Library/Logs/Claude/mcp*.log` (`mcp-server-devdigest.log` has our stderr).

### Codex — `~/.codex/config.toml`

Global file `~/.codex/config.toml`; a project-scoped `.codex/config.toml` is read for trusted
projects. Not committed here (the repo's `.codex/` holds agents only).

```toml
[mcp_servers.devdigest]
command = "npm"
args = ["--silent", "run", "dev"]
cwd = "/ABSOLUTE/PATH/TO/ai-dev-digest/mcp"
startup_timeout_sec = 30
tool_timeout_sec = 150

[mcp_servers.devdigest.env]
DEVDIGEST_API_URL = "http://127.0.0.1:3001"
DEVDIGEST_MCP_WAIT_MS = "120000"
```

- `cwd` is supported, so `npm run dev` runs inside `mcp/` without `--prefix`.
- **Tool timeout:** `tool_timeout_sec`, default **60 s**; `startup_timeout_sec`, default **10 s**
  (`npm`+`tsx` cold start can be slower, hence 30). The default 60 s is shorter than the 120 s
  wait, so either set `tool_timeout_sec` to wait limit + margin (150 above) or lower
  `DEVDIGEST_MCP_WAIT_MS` to about `50000`.

### Rule of thumb

Client tool-call timeout must be **>= `DEVDIGEST_MCP_WAIT_MS` + margin (about 30 s)**. If the client
cannot be configured, lower `DEVDIGEST_MCP_WAIT_MS` instead; otherwise the client shows a
failed call although the run is still going in the API.

| Client | Tool-call timeout | What to do |
|---|---|---|
| Claude Code | `MCP_TOOL_TIMEOUT` / per-server `timeout`, ms, default ~28 h | nothing |
| Cursor | not configurable; ~60 s in CLI/ACP, ~60 min in IDE (forum, not docs) | CLI: `DEVDIGEST_MCP_WAIT_MS=50000` |
| Claude Desktop | ~60 s, not configurable (issue report, not docs) | `DEVDIGEST_MCP_WAIT_MS=50000` |
| Codex | `tool_timeout_sec`, default 60 s | `tool_timeout_sec = 150` or `DEVDIGEST_MCP_WAIT_MS=50000` |

## MCP Inspector checklist

Start the API (`./scripts/dev.sh`), then:

```bash
cd mcp && npm run inspect
```

`npm run inspect` runs `npx @modelcontextprotocol/inspector -e DEVDIGEST_API_URL=... -e DEVDIGEST_MCP_WAIT_MS=... tsx src/index.ts`
(env values are passed explicitly with `-e`, defaults as above; the script uses POSIX `${VAR:-default}`
so it needs a POSIX shell). The launcher prints a URL with a one-time session token; open that
URL, not a hand-typed `localhost:6274`. The first run downloads the Inspector through `npx`
(needs network, Node >= 22.19). To override: `DEVDIGEST_MCP_WAIT_MS=3000 npm run inspect`.

Scriptable variant (same package, CLI mode):

```bash
cd mcp
npx @modelcontextprotocol/inspector --cli -e DEVDIGEST_API_URL=http://127.0.0.1:3001 tsx src/index.ts --method tools/list --format json
npx @modelcontextprotocol/inspector --cli tsx src/index.ts --method tools/call --tool-name list_agents
npx @modelcontextprotocol/inspector --cli tsx src/index.ts --method tools/call --tool-name get_findings --tool-arg repo=acme/payments-api --tool-arg pr=482
```

`--tool-arg` JSON-coerces values (`pr=482` becomes a number); a tool error (`isError`) exits with code 5.

Seed facts used below (from `server/src/db/seed.ts`): one repo `acme/payments-api`, one PR `#482`
("Add rate limiting to public API endpoints", 9 files, status `needs_review`), five enabled agents:
`General Reviewer`, `Security Reviewer`, `Performance Reviewer`, `Test Quality Reviewer`,
`API Contract Reviewer`. The seed also inserts one review on PR #482 (verdict `request_changes`,
score 61, model `seed`) with two findings: CRITICAL "Hardcoded Stripe secret key in commit"
(`src/config.ts:12`) and WARNING "N+1 query in user list endpoint" (`src/api/users.ts:45`).
It seeds no conventions scan.

Tick each item; paste what you see in the "Observed" column. **Nothing here has been run yet.**

| # | Check | Expected | Observed |
|---|---|---|---|
| 1 | Connect; `initialize` result | `instructions` = `DevDigest PR review. Start with list_agents.`; stderr (Console tab) shows `ready (API http://127.0.0.1:3001, run wait limit 120000 ms)` | |
| 2 | Tools tab: tool count and names | exactly 5: `list_agents`, `run_agent_on_pr`, `get_findings`, `get_conventions`, `get_blast_radius` | |
| 3 | Schemas | flat scalars only; `pr` integer min 1; `severity` enum `CRITICAL`/`WARNING`/`SUGGESTION`; `category` enum `naming`/`structure`/`testing`/`error-handling`/`api-contract`/`other`; no `outputSchema`; parameter descriptions as in the table above | |
| 4 | Annotations | `readOnlyHint: true` on `list_agents`, `get_findings`, `get_conventions`, `get_blast_radius`; **no** `readOnlyHint` on `run_agent_on_pr` | |
| 5 | `list_agents` | 5 agents with `name`, `description` (<= 120 chars), `enabled`; no prompts or model config. Record response size (chars/bytes) | |
| 6 | `get_findings repo=acme/payments-api pr=482` | the seeded review: `verdict: request_changes`, `score: 61`, counts critical 1 / warning 1 / suggestion 0, two findings, CRITICAL first, `more: 0`. The seed review has no agent, so `agent` may be an empty string (assumption, check). Record size | |
| 7 | `get_findings ... severity=CRITICAL` | `findings` has only the Stripe key finding; `counts` still describe the whole review (critical 1, warning 1) | |
| 8 | `get_findings ... agent=Security Reviewer` | hint `No reviews by agent 'Security Reviewer' on PR #482 of acme/payments-api yet. Call run_agent_on_pr to run one.` (seed review is not tied to an agent; assumption) | |
| 9 | `get_conventions repo=acme/payments-api` | `No conventions scan for acme/payments-api yet. Ask the user to run the Conventions extractor in DevDigest.` (no scan in seed). After running the extractor in the UI: record size with all rules (cap 50, `more`) | |
| 10 | `get_blast_radius repo=acme/payments-api pr=482` | Real data: JSON with `summary`, `changed_symbols`, `downstream` (callers as `file`/`line`). For a PR never opened in the UI or an unindexed repo: `degraded: true`, `degraded_reason: no_data` and a `hint`, not an error. With `pr=0`: input validation error | |
| 11 | Error: unknown agent: `run_agent_on_pr ... agent=Nope` | `Agent 'Nope' not found. Call list_agents for valid names.` (nothing started: check the API runs list) | |
| 12 | Error: repo not added: `repo=octo/missing` | `Repo 'octo/missing' is not added to DevDigest. Known repos: acme/payments-api. Ask the user to add it in the DevDigest UI.` | |
| 13 | Error: invalid repo: `repo=payments-api` | `Repo 'payments-api' is not valid. Use the form owner/name, for example acme/payments-api.` | |
| 14 | Error: PR not imported: `pr=9999` | `PR #9999 is not imported for acme/payments-api. Ask the user to import pull requests in DevDigest.` | |
| 15 | Error: API down (stop the API, call `list_agents`) | `DevDigest API is not reachable at http://127.0.0.1:3001. Ask the user to run ./scripts/dev.sh. Do not retry.` | |
| 16 | Error: rate limit (call `run_agent_on_pr` more than 10 times in a minute) | `Review rate limit reached (10/min). Wait a minute before calling run_agent_on_pr again.` | |
| 17 | Error: run failed (e.g. the LLM key is missing in `server/.env`) | `Run <id> failed: <error>. Call run_agent_on_pr again or pick another agent.` | |
| 18 | `run_agent_on_pr` success path (needs an LLM key; see note) | review shape `{run_id, agent, verdict, score, counts, findings, more}`, <= 10 findings, `why` <= 300 chars. Record duration and size | |
| 19 | `run_agent_on_pr` at the wait limit: restart with `DEVDIGEST_MCP_WAIT_MS=1000` | `{run_id, status:"running", hint:"Still running. Call get_findings for this PR in ~30s."}` and the run still finishes in the API | |
| 20 | Tool call while a run for the same agent is active | attaches to the active run, does not start a second paid run (check run list in the UI) | |
| 21 | Nothing but JSON-RPC on stdout | Protocol tab shows no parse errors; no stray text | |
| 22 | Startup validation: `DEVDIGEST_MCP_WAIT_MS=abc npm run dev` | exits with `DEVDIGEST_MCP_WAIT_MS must be an integer between 1000 and 600000 (milliseconds), got "abc"` on stderr | |

Note on 18-20: the seeded PR #482 belongs to a fictional repo (`clonePath` null, fake head sha), so a real
run on it may fail at the diff/LLM step rather than succeed. How the API fetches the diff for it was not
checked. For a success path import a real repository and PR in the DevDigest UI and use those names.

## End-to-end scenario (Claude Code)

With the API running and `mcp/` installed, open Claude Code in the repo root, approve the
`devdigest` project server, and check `/mcp` shows it connected with 5 tools. Then ask:

> Зроби ревʼю PR №3 у репозиторії агентом Security Reviewer і скажи, чи є критичні знахідки

(Add the repo name, e.g. `acme/payments-api`, and use a PR that exists: the seed only has
**#482**, so with the seed alone use "PR №482". PR №3 works only if you imported it.)

Expected: `list_agents` (finds `Security Reviewer`) -> `run_agent_on_pr` (blocks up to the wait limit,
returns verdict and findings) -> optionally `get_findings` if the run returned `status:"running"`.
The answer must say whether `counts.critical` is above zero, without inventing findings. See
`mcp/evals/tasks.md` for this and nine more prompts with a results table.

## Documentation consulted (checked 2026-10-04)

- Claude Code MCP: https://code.claude.com/docs/en/mcp (redirect from docs.claude.com/en/docs/claude-code/mcp) — `.mcp.json`, `${VAR:-default}` in `command`/`args`/`env`, no `cwd`, `CLAUDE_PROJECT_DIR`, `MCP_TOOL_TIMEOUT`, per-server `timeout`, approval prompt, `claude mcp add ... -- cmd`.
- MCP Inspector: https://modelcontextprotocol.io/docs/tools/inspector , `.../2026-07-28/tools/inspector/cli` , `.../configuration` , `.../web` — `npx @modelcontextprotocol/inspector <cmd>`, `-e KEY=VALUE`, `--cwd`, `--`, `--cli --method tools/list|tools/call --tool-name --tool-arg`, exit code 5 on tool error, session-token URL, Node >= 22.19. **Not verified:** the Inspector's own request timeout (the pages fetched do not state a default); if a long `run_agent_on_pr` call times out in the Inspector UI, check its per-server timeout settings.
- Cursor: https://cursor.com/docs/context/mcp — `.cursor/mcp.json`, `command`/`args`/`env`/`envFile`, interpolation variables. No timeout setting documented. Forum (not docs): https://forum.cursor.com/t/agent-acp-mcp-tools-call-times-out-at-60s-with-no-way-to-configure-it/163925
- Claude Desktop: https://modelcontextprotocol.io/docs/develop/connect-local-servers — config file paths, JSON shape, restart, absolute paths, logs. Timeout: issue report only, https://claudeissues.com/issue/63379-bug-desktop-app-cancels-stdio-mcp-tool-calls-at-60s-and-ignores-mcp-tool-timeout
- Codex: https://developers.openai.com/codex/mcp (redirects to https://learn.chatgpt.com/docs/extend/mcp?surface=cli) — `[mcp_servers.<name>]`, `command`/`args`/`env`/`cwd`, `startup_timeout_sec` (10 s), `tool_timeout_sec` (60 s). `codex mcp add` shown in the doc only for `--url` servers; the stdio form was not verified, so edit the TOML.

## Related skill

`.claude/skills/github-connection/` teaches the agent when to use `gh` (GitHub facts: repos, PRs, diffs, counts) and when to use these tools (DevDigest facts: agents, findings, conventions), and the safe order for reviewing a GitHub PR with DevDigest. This server intentionally has no `list_repos`/`list_prs`.
