# Verification — DevDigest MCP (2026-10-04)

Legend: ✅ evidenced · ⏳ needs a run on your machine (fill the blank cells).

## 1. Inspector sees all five tools with correct schemas — ✅
Screenshots of the Tools tab show `list_agents`, `run_agent_on_pr`, `get_findings`,
`get_conventions`, `get_blast_radius`. `list_agents` returned real data after the
IPv4 fix (`127.0.0.1`). Schemas/annotations are locked by `test/` (161 tests green).
Re-check any time: `cd mcp && npm run inspect`.

## 2. `devdigest-mcp` starts with a separate command — ✅
```bash
cd mcp && DEVDIGEST_API_URL=http://127.0.0.1:3001 npm run dev   # stdio, logs to stderr only
```

## 3. Claude Code: list_agents → run_agent_on_pr → get_findings — ⏳
Prereqs: full restart of Claude Code, `/mcp` shows `devdigest` connected, API running
(`./scripts/dev.sh` from repo root), repo + PR imported in DevDigest.
Prompt (seed example):
> Зроби ревʼю PR №482 у репозиторії acme/payments-api агентом Security Reviewer і скажи, чи є критичні знахідки.

Expected call order: `list_agents` → `run_agent_on_pr` → `get_findings`; answer cites real findings.

| Observed tool order | Critical found? | Pass |
|---|---|---|
|  |  |  |

## 4. Unknown agent / PR — hint points to the fix — ✅ unit-tested, ⏳ live
Call in Inspector (or ask Claude Code); expected `isError: true` text:

| Input | Expected message |
|---|---|
| `agent="Nope"` | `Agent 'Nope' not found. Call list_agents for valid names.` |
| `pr=9999` (known repo) | `PR #9999 is not imported for <repo>. Ask the user to import pull requests in DevDigest.` |
| `repo="acme/zzz"` | `Repo 'acme/zzz' is not added to DevDigest. Known repos: …. Ask the user to add it in the DevDigest UI.` |
| `repo="../x"` | `Repo '../x' is not valid. Use the form owner/name, for example acme/payments-api.` |

Live result: ☐ matches ☐ differs: ______

## 5. `/context` baseline — ⏳ (only you can run `/context`)
Run `/context` in a fresh session for each state; record "MCP tools" tokens.

| State | How to set it | MCP tools tokens | Tools count |
|---|---|---|---|
| A. Baseline (devdigest only, no GitHub MCP) | `ENABLE_TOOL_SEARCH=false` |  | 5 |
| B. Full GitHub MCP | add server below without toolsets, `ENABLE_TOOL_SEARCH=false` |  |  |
| C. Restricted toolsets | add `X-MCP-Toolsets: repos,pull_requests` |  |  |
| D. Tool Search | `ENABLE_TOOL_SEARCH=true` (current setting) + full GitHub MCP |  |  |

## 6. GitHub MCP is read-only during the demo — ⏳ config
Example (do NOT commit a token; use a custom env var name, set it in your shell):
```json
{
  "mcpServers": {
    "github-ro": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${GH_MCP_PAT}",
        "X-MCP-Readonly": "true",
        "X-MCP-Toolsets": "repos,pull_requests"
      }
    }
  }
}
```
Alternative: URL `https://api.githubcopilot.com/mcp/readonly`.
Check: `/mcp` → github-ro tools list has no create/update/merge/push tools;
ask Claude to "create an issue" and confirm it has no tool for it.
