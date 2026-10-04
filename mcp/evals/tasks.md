# DevDigest MCP — evaluation tasks (plan step 7)

Real prompts to run through an actual client (Claude Code first; repeat the key ones in
Cursor / Desktop / Codex). **No results are recorded yet: every table below is blank and must
be filled by a person who ran the prompt.** Nothing here was run by the author.

## How to run

1. `./scripts/dev.sh` (API on :3001, seeded). `cd mcp && npm install`. Config: see `mcp/README.md`.
2. Start a **fresh** client session per task (no memory of earlier tasks). Note the client, model and
   `DEVDIGEST_MCP_WAIT_MS` in the header of each run.
3. Count every MCP call the model makes (including failed ones). Mark a "mistake" when the model
   calls a wrong tool, guesses an argument, retries after a "do not retry" error, starts a second
   paid run, invents data, or ignores a hint. Quote the confusing text in Notes.
4. A mistake caused by wording: fix the error hint first; change a description only via the plan's
   "Tool descriptions" section, then code, then re-run `mcp/test/tools-list.test.ts` (plan step 2).

Seeded names (from `server/src/db/seed.ts`): repo `acme/payments-api`, PR `#482`, agents
`General Reviewer`, `Security Reviewer`, `Performance Reviewer`, `Test Quality Reviewer`,
`API Contract Reviewer`. Seeded review on #482: `request_changes`, score 61, 1 CRITICAL (Stripe key,
`src/config.ts:12`) + 1 WARNING (N+1, `src/api/users.ts:45`). **Assumed** (not checked in code): the seeded
review is not attached to an agent; no conventions scan exists in the seed; a real review run
on the fictional seeded PR may fail at the diff/LLM step. Tasks marked "needs real PR" use a
repository and PR you imported yourself (fill in the names in the header of that task).

Results table template (same for every task):

| Client / model | Calls made (in order) | Call count | Mistakes | Final answer correct? | Notes |
|---|---|---|---|---|---|
| | | | | | |

---

## 1. Security review of a PR (the main scenario)

Prompt (Ukrainian, as the user would type it):
> Зроби ревʼю PR №3 у репозиторії acme/payments-api агентом Security Reviewer і скажи, чи є критичні знахідки

- Needs real PR: PR #3 is not in the seed. Either import a real repo/PR and substitute its name and number, or use `PR №482` on the seeded repo (expect the run to fail or be slow, which is itself the "run failed" path). Used repo/PR: `____`
- Expected sequence: `list_agents` -> `run_agent_on_pr(repo, pr, agent="Security Reviewer")`. `get_findings` is optional and only sensible if the run returned `status:"running"`. Ideal 2 calls, acceptable 3.
- Pass: agent name taken from `list_agents` exactly; verdict and number of critical findings reported from `counts.critical`; no invented findings; exactly one `run_agent_on_pr`.

Results: (template above)

## 2. Naming conventions

Prompt:
> Які правила іменування прийняті в репозиторії acme/payments-api?

- Expected: one `get_conventions(repo="acme/payments-api", category="naming")` (category filter is optional; omitting it is not a mistake). No agent call.
- On the seed (assumed no scan): error hint `No conventions scan ... Ask the user to run the Conventions extractor in DevDigest.` The model must relay that and stop (no retry, no `run_agent_on_pr`). After running the Conventions extractor in the UI: answer lists naming rules with `path:line` evidence.
- Run it twice: before and after the scan.

Results: (template above)

## 3. Unknown agent name

Prompt:
> Запусти агента "Docs Reviewer" на PR №482 у acme/payments-api

- Expected: `list_agents` (first or after the error) -> tell the user there is no such agent and list real ones; do not silently substitute another agent. Acceptable: `run_agent_on_pr("Docs Reviewer")` -> error `Agent 'Docs Reviewer' not found. Call list_agents for valid names.` -> `list_agents` -> ask the user. Ideal 1-2 calls, acceptable 3.
- Pass: no review is started (check the runs list for PR #482).

Results: (template above)

## 4. API stopped

Setup: stop the API (Ctrl-C in `./scripts/dev.sh` or stop the server process).
Prompt:
> Покажи знахідки PR №482 у acme/payments-api

- Expected: exactly one `get_findings` call -> `DevDigest API is not reachable at http://127.0.0.1:3001. Ask the user to run ./scripts/dev.sh. Do not retry.` -> the model tells the user to start the API.
- Pass: 1 call, no retry, no other tool tried. Restart the API afterwards.

Results: (template above)

## 5. Blast radius requested

Prompt:
> Покажи blast radius для PR №482 в acme/payments-api

- Expected: exactly one `get_blast_radius` call -> `get_blast_radius is not implemented yet. Do not retry; continue without it.` -> the model says it is not available and offers an alternative (e.g. `get_findings`) without calling the stub again.
- Pass: call count is 1 for `get_blast_radius`; no retry; no invented blast-radius data.

Results: (template above)

## 6. Repository not added

Prompt:
> Зроби ревʼю PR №12 у репозиторії octo/unknown-repo агентом General Reviewer

- Expected: `list_agents` (optional) -> `run_agent_on_pr` -> `Repo 'octo/unknown-repo' is not added to DevDigest. Known repos: ... Ask the user to add it in the DevDigest UI.` -> the model asks the user to add the repo; offers `acme/payments-api` if it wants, but does not run anything on it unasked.
- Pass: no paid run started; no retry with a guessed repo.

Results: (template above)

## 7. PR not imported

Prompt:
> Запусти General Reviewer на PR №9999 у acme/payments-api

- Expected: `list_agents` (optional) -> `run_agent_on_pr` -> `PR #9999 is not imported for acme/payments-api. Ask the user to import pull requests in DevDigest.` -> the model relays it and stops.
- Pass: 1 error, no retry, no run.

Results: (template above)

## 8. Run takes longer than the wait limit (attach / timeout path)

Setup: set `DEVDIGEST_MCP_WAIT_MS=2000` (valid range 1000-600000) in the client config and restart the client. Needs a PR where a review really takes more than 2 s (needs real PR, with a working LLM key in `server/.env`). Used repo/PR: `____`
Prompt:
> Зроби ревʼю PR №__ у репозиторії __ агентом Security Reviewer і скажи, чи є критичні знахідки

- Expected: `list_agents` -> `run_agent_on_pr` -> `{run_id, status:"running", hint:"Still running. Call get_findings for this PR in ~30s."}` -> the model tells the user it is still running and, after ~30 s (or when the user asks again), calls `get_findings` (not a second `run_agent_on_pr`).
- Pass: no second paid run. If the model does call `run_agent_on_pr` again, record whether the server attached to the active run (UI shows one run, not two) and still mark it as a model mistake.
- Also try the same with the client's own timeout lower than the wait limit (e.g. Codex default `tool_timeout_sec` 60 s with `DEVDIGEST_MCP_WAIT_MS=120000`) and record what the user sees.

Results: (template above)

## 9. Severity filter

Prompt:
> Покажи тільки критичні знахідки в PR №482 у acme/payments-api

- Expected: one `get_findings(repo="acme/payments-api", pr=482, severity="CRITICAL")`; no `run_agent_on_pr`.
- On the seed: the Stripe key finding only; `counts` still show 1 critical / 1 warning for the whole review. The answer must not claim "there is only one finding in total".
- Pass: 1 call, correct `severity` value (uppercase enum), no review started.

Results: (template above)

## 10. List the agents (baseline, no side effects)

Prompt:
> Які агенти рев'ю є в DevDigest і для чого кожен?

- Expected: one `list_agents`; answer lists the 5 seeded agents with their one-line descriptions.
- Pass: 1 call; no `run_agent_on_pr`; nothing invented beyond `name`/`description`/`enabled`.

Results: (template above)

---

## Summary (fill in after all runs)

| Task | Client | Calls | Mistakes | Fix needed (hint / description / none) |
|---|---|---|---|---|
| 1 Security review | | | | |
| 2 Naming conventions | | | | |
| 3 Unknown agent | | | | |
| 4 API stopped | | | | |
| 5 Blast radius | | | | |
| 6 Repo not added | | | | |
| 7 PR not imported | | | | |
| 8 Wait-limit path | | | | |
| 9 Severity filter | | | | |
| 10 List agents | | | | |
