# Agents

Map of the custom subagents in `.claude/agents/`. This file is an index, not a copy — for
the actual rules, workflow steps, and output templates, read each agent's own `.md` file.

## Roster

| Agent | Responsibility | Model | Tools | Input | Output |
|-------|-----------------|-------|-------|-------|--------|
| [`brainstorm`](brainstorm.md) | Explores a fuzzy idea before planning: 3–5 genuinely different approaches grounded in repo modules, skills and constraints, with trade-offs and a recommended direction. Writes nothing; never picks for the user. | `sonnet` | `Read, Grep, Glob, Bash, WebSearch, WebFetch` (no `Write`/`Edit` — enforced; `Bash` read-only by prompt convention) | A fuzzy idea/feature request; asks clarifying questions first if there is no goal | Options Brief: options, comparison table, recommended direction, open questions, hand-off paragraph for `planner` |
| [`researcher`](researcher.md) | Finds information — in the repo or from external sources — and reports it with evidence. Makes no changes. | `sonnet` | `Read, Grep, Glob, Bash, WebSearch, WebFetch` | A question (repo-scoped, external, or both); asks clarifying questions first if the question isn't concrete | Structured report: findings, evidence table, references, "Could not find" section |
| [`planner`](planner.md) | Turns a task/feature request into a structured Development Plan, grounded in project modules, `.claude/skills/`, `INSIGHTS.md`, and `AGENTS.md` constraints. Writes no application code. | `sonnet` | `Read, Grep, Glob, Bash, Write` (`Write` restricted by prompt convention to `docs/plans/**` only — no sandbox enforcement) | A task/feature request; asks clarifying questions first if scope/goal is unclear | Development Plan — saved to `docs/plans/<date>-<slug>.md` and returned in the response |
| [`implementer`](implementer.md) | Executes a Development Plan across frontend and backend, runs the existing test suite, self-checks only its own diff. Does not do architecture/security review or issue a merge verdict. | `sonnet` | `Read, Grep, Glob, Bash, Write, Edit` (`Bash` restricted by prompt convention to package scripts and read-only git commands — no destructive/history-rewriting commands) | A Development Plan (from `planner`, inline or as a `docs/plans/` path) | Implementation Report: skills applied, files changed, test results, self-check, deviations, explicit out-of-scope items |
| [`test-writer`](test-writer.md) | Writes and runs tests for a feature/diff/plan: client (Vitest + RTL), server unit (Fastify inject) and `*.it.test.ts` (real Postgres). Edits test files only; never production code (prompt-level). | `sonnet` | `Read, Grep, Glob, Bash, Write, Edit` (`Write`/`Edit` restricted by prompt convention to test paths; `Bash` to test/typecheck scripts and read-only git) | Plan ("Testing strategy") or diff + behaviors | Test Report: tests written, commands/results (skipped ≠ passed), suspected production defects, guard check |
| [`architecture-reviewer`](architecture-reviewer.md) | Read-only architecture-boundary review with evidence; complements (does not replace) `pr-self-review`. | `sonnet` | `Read, Grep, Glob, Bash` (no `Write`/`Edit` — enforced; `Bash` read-only by prompt convention) | Git range or paths | Architecture Review: findings (`rule_source`, `file:line`, quoted evidence, severity, confidence), rules checked/skipped |
| [`security-reviewer`](security-reviewer.md) | Read-only security review with evidence and traced attacker-controlled sources: authn/authz, workspace isolation, injection, SSRF, secrets, untrusted content in `reviewer-core`, dependency risk. Complements (does not replace) `pr-self-review`. | `sonnet` | `Read, Grep, Glob, Bash` (no `Write`/`Edit` — enforced; `Bash` read-only by prompt convention) | Git range or paths | Security Review: findings (`rule_source`, `owasp`, `file:line`, quoted evidence, `source`, `data_flow`, severity, confidence), checks run/skipped |
| [`plan-verifier`](plan-verifier.md) | Read-only item-by-item check of finished code against a Development Plan and requirements. | `sonnet` | `Read, Grep, Glob, Bash` (no `Write`/`Edit` — enforced; `Bash` read-only by prompt convention) | Plan path + git range (+ optional requirements) | Traceability matrix (PASS/FAIL/PARTIAL/NOT-VERIFIED + evidence), unplanned changes, plan status |
| [`doc-writer`](doc-writer.md) | Documents implemented features (from code, plans, reports) with Mermaid diagrams; marks planned vs shipped; never invents behavior. | `sonnet` | `Read, Grep, Glob, Bash, Write, Edit` (writes restricted by prompt convention to docs paths) | Feature + sources (plan/report/range) | Documentation Report: files, status map, evidence index, discrepancies |

`Bash` access on every agent is a **prompt-level convention**, not a
sandboxed restriction — the frontmatter `tools:` field grants the whole `Bash` tool; each agent's
own "Hard constraints" section is what limits it to read-only or non-destructive commands.

### Enforced vs prompt-level restrictions

Two different kinds of guarantee are at work across the roster, and they should not be confused:

| Restriction | Mechanism | Enforced? |
|---|---|---|
| Read-only agents (`brainstorm`, `researcher`, `architecture-reviewer`, `security-reviewer`, `plan-verifier`) have no Write/Edit | `tools:` allowlist omits `Write, Edit` | Yes — the tool is unavailable to the agent |
| Bash doesn't write files (review agents) | text in "Hard constraints" | No — Bash can still do `>`, `tee`, `sed -i`; a `disallowedTools: Bash(...)` specifier removes the whole Bash tool rather than narrowing it |
| `test-writer` writes only test paths | text in "Hard constraints" + a self-check via `git status --porcelain` | No (`Write`/`Edit` are allowed anywhere) |
| `doc-writer` writes only docs paths | text + a self-check | No |
| Bash limited to read-only / package scripts | text | No |
| Governed by `permissionMode` | not used — `bypass`/`acceptEdits`/`auto` modes are inherited from the parent session, so a subagent's own `permissionMode` cannot be relied on as a barrier | not relied on |
| Hooks (optional hardening, not yet adopted) | a `PreToolUse` hook in `.claude/settings.json` reading `agent_type` from the hook input, allowlisting Bash commands or Write/Edit paths per agent, `exit 2` to block | Partial, if adopted — narrows but doesn't eliminate workarounds (e.g. `python -c`, `node -e`); requires a new `.claude/settings.json` (currently only an untracked `settings.local.json` exists) and a separate approval before use |

None of the agents are "sandboxed" — treat every restriction not marked "Enforced" above as a convention the agent is expected to follow, not a barrier that stops it.

## Preloaded skills (`skills:` frontmatter)

`planner` and `implementer` both preload the same twelve `.claude/skills/` entries at startup —
`onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`,
`zod`, `ui-frontend-architecture`, `next-best-practices`, `react-best-practices`,
`react-testing-library`, `typescript-expert`, `security`, `engineering-insights` — so the plan
already reflects every best-practice rule the implementer will be held to, instead of the
implementer discovering a conflict after the fact. Skills outside that set (`mermaid-diagram`,
`pr-self-review`) are read on demand, not preloaded. `researcher` has no `skills:` field; it
reads whichever `SKILL.md` files a given research question touches.

The newer agents preload a deliberately smaller set — only what each one needs on
every invocation, not the full 12-skill set:

- `test-writer` — `react-testing-library`, `fastify-best-practices`, `zod`, `drizzle-orm-patterns`.
- `architecture-reviewer` — `onion-architecture`, `ui-frontend-architecture`.
- `security-reviewer` — `security` (its Express/Mongo examples are mapped to Fastify/Drizzle/Next.js in the agent's "Stack mapping" section).
- `brainstorm` — no preload; like `researcher`, it reads whichever `SKILL.md` files constrain the idea.
- `doc-writer` — `mermaid-diagram`.
- `plan-verifier` — no preload; it reads a skill's `SKILL.md` on demand only when the plan it's
  checking explicitly cites that skill.

`skills:` preload injects a skill's full content at agent startup, which costs context/tokens
proportional to the skill's size — this is why the newer agents preload less than `planner`/
`implementer`. If a dry-run shows an agent systematically missing a rule from a non-preloaded
skill, that skill should move into its `skills:` list.

## Pipeline

```
brainstorm  →  (optional) Options Brief; the user picks a direction
researcher  →  (optional) findings feed into a task/feature request
planner     →  Development Plan  (docs/plans/<date>-<slug>.md)
implementer →  Implementation Report  (code changes + tests + self-check)
test-writer →  Test Report  (test files only; TDD-first use is also allowed)
architecture-reviewer  →  Architecture Review  (read-only, layering findings)    ⎫
security-reviewer      →  Security Review  (read-only, security findings)         ⎬ run in parallel,
plan-verifier          →  Plan Verification Report  (read-only, traceability)     ⎭ same git range
pr-self-review (skill, not an agent) →  PASS / BLOCKED / REVIEW_FAILED / PARTIAL — the one place merge status is decided
doc-writer  →  Documentation, with Shipped/Planned/Partial/Unverified status labels
```

`architecture-reviewer`, `security-reviewer` and `plan-verifier` are independent of each other and
can run in parallel against the same range. Their duties do not overlap:

| Concern | Owner |
|---|---|
| Layering, forbidden imports, barrel exports, module shape, vendor/shared symlink, migration append-only, lock-file/"Do Not Touch" edits | `architecture-reviewer` |
| AuthN/AuthZ, workspace isolation, injection, SSRF, secrets, untrusted-content handling, input validation as a security control, dependency risk | `security-reviewer` |
| Plan-vs-code traceability | `plan-verifier` |
| Contract/DB-safety-in-substance, final dedup, merge status (`PASS/BLOCKED/REVIEW_FAILED/PARTIAL`) | `pr-self-review` (skill) |

When one defect has both a layering and a security consequence, each reviewer reports only its
own side and adds `see also: <other agent>`; `pr-self-review` merges them into one canonical
finding per `finding-policy.md`. Both reviewers only set a per-finding `blocking_candidate`.

Findings from any of them can flow back into a
further `implementer` invocation; agents never call each other directly — the user (or the main
session) drives the pipeline between steps.

`implementer` explicitly excludes architecture review, plan-vs-code traceability, security
review, and any PASS/BLOCKED merge decision — architecture review, security review and plan
tracing are `architecture-reviewer`'s, `security-reviewer`'s and `plan-verifier`'s jobs
respectively; the merge status remains `pr-self-review`'s alone. Implementation and review never share one agent.

## Sources behind the agents' rules

| Rule | Source | Applied in |
|------|--------|------------|
| `tools:` is an allowlist; an agent can use only what's listed | Claude Code docs, `sub-agents.md` | `tools:` frontmatter of every agent |
| `model:` accepts an alias (`sonnet`) resolved to the latest model in that family | Claude Code docs, `sub-agents.md` | `model: sonnet` in every agent |
| `description:` should be short and condition-like — it drives auto-delegation | Claude Code docs, `sub-agents.md` | One-line `description:` in every agent |
| Least-privilege example pattern (read-only agent, no `Edit`) | Claude Code docs, `sub-agents.md` | `planner` has no `Edit`; `brainstorm`/`architecture-reviewer`/`security-reviewer`/`plan-verifier` have no `Write`/`Edit` at all; all agents restrict `Bash` to read-only/non-destructive commands by prompt |
| No native way to scope `Bash` to specific subcommands or `Write` to a specific path — must be stated as a prompt convention | Claude Code docs, `sub-agents.md` (documented gap) | "Hard constraints" in every agent; `planner`'s `Write` restricted to `docs/plans/**`, `test-writer`'s to test paths, `doc-writer`'s to docs paths, all by convention only |
| A `disallowedTools` entry like `Bash(git push *)` removes the whole `Bash` tool rather than narrowing it; a `PreToolUse` hook (exit 2 blocks) is the only documented way to narrow `Bash` itself, and hooks fire inside subagents with `agent_type` in their input | Claude Code docs, `sub-agents.md` and `hooks.md` | "Enforced vs prompt-level restrictions" above; the optional Phase-2 hooks row |
| A planner's output is passed as context into the next agent's input, not implied via shared filesystem state | Claude Code docs, `workflows.md` | `planner` step "Write the plan" (also persists a file per this project's request); `implementer` step "Read the plan"; `plan-verifier`'s "accept a plan" step |
| Implementation and review must be separate agents — one agent shouldn't both implement and issue a verdict | Claude Code docs, `sub-agents.md` | `implementer`'s "Hard constraints" + "Explicitly out of scope"; `architecture-reviewer`, `security-reviewer` and `plan-verifier` being separate, read-only agents from `implementer` |
| `skills:` frontmatter preloads skill content at agent startup instead of relying on runtime discovery; missing skill names are silently skipped | Claude Code docs, `skills.md` | `skills:` field in `planner`, `implementer`, `test-writer`, `architecture-reviewer`, `security-reviewer`, `doc-writer`; skill names must match `.claude/skills/<name>/SKILL.md` exactly |
| Route changed/touched files to the skills that match their layer (frontend vs. backend vs. cross-cutting) | `.claude/skills/pr-self-review/SKILL.md`, "Routing principles" | `planner`'s per-step skill mapping; `implementer`'s step 3; `test-writer`'s file-location classification |
| Read the relevant module `INSIGHTS.md` before working; capture new findings append-only in the repo's dated format | Root `AGENTS.md`, "Session Protocol" / "Context Loading Strategy" | `planner` step 2; `implementer` steps 2 and 7; `test-writer` and `doc-writer` step 1 |
| Enumerate `.claude/skills/*/SKILL.md` (and `.agents/skills/*`) as part of the project contract | Root `AGENTS.md`, "Repository-local skills" | `planner` step 3; `implementer`'s skill application step |
| Respect "Do Not Touch" items and the append-only migration journal even if a plan step seems to imply otherwise | Root `AGENTS.md`, "Do Not Touch" | `implementer`'s "Hard constraints"; `architecture-reviewer`'s migration-journal check; `test-writer`'s forbidden-paths list |
| Don't overclaim a review's completeness or issue a severity/merge verdict outside the dedicated review flow | `.claude/skills/pr-self-review/SKILL.md`, "Output contract" / "Blocking rule" (used as a contrast) | `implementer`'s "Self-check (own diff only)" section; `architecture-reviewer`'s `blocking_candidate` (never PASS/BLOCKED); `plan-verifier`'s plan status (never a merge verdict) |
| Security review is confidence-based: trace the data flow and confirm the input is attacker-controlled before reporting; OWASP Top 10:2025 categories | `.claude/skills/security/SKILL.md`, "Core Philosophy" / OWASP table | `security-reviewer`'s workflow steps 4–5 and `owasp` field |
| Every request resolves user, workspace and `workspace_members` membership; cross-workspace access is 403 | `server/AGENTS.md`, "Authentication boundary"; `server/src/modules/_shared/context.ts` | `security-reviewer`'s authn/workspace-isolation check |
| Blocking only for high-confidence critical, or high-confidence high in auth/authz/isolation/secrets/injection | `.claude/skills/pr-self-review/SKILL.md`, "Blocking rule"; `references/finding-policy.md` | `security-reviewer`'s `blocking_candidate` rule |
| The Clean/Onion Architecture dependency rule (dependencies point inward only) | Uncle Bob, "The Clean Architecture"; ArchUnit user guide (evidence format: rule + from→to + file:line) | `architecture-reviewer`'s rule catalog and finding schema |
| Dependency-rule tooling reports findings as rule name + severity + from/to path | `dependency-cruiser` (GitHub) | `architecture-reviewer`'s finding schema and its use of `pnpm architecture:check` |
| Requirements traceability uses a bidirectional matrix (forward: requirement → implementation/test; backward: code → requirement); empty cells are gaps | Wikipedia, "Requirements traceability" | `plan-verifier`'s item breakdown and traceability matrix |
| LLM-as-a-judge is prone to position/verbosity/self-preference bias; mitigate with a fixed rubric, verbatim evidence, and separating the generator from the verifier | Wikipedia, "LLM-as-a-Judge" | `plan-verifier`'s status vocabulary and self-preference caveat |
| Test what a user of the code observes, not implementation details; Testing Library query priority (`getByRole` first, `getByTestId` last); avoid over-mocking; mock at the network boundary | Kent C. Dodds, "Testing Implementation Details" / "Write tests. Not too many. Mostly integration." / "Stop mocking fetch"; testing-library.com query priority docs | `test-writer`'s UI testing rules |
| Fastify's `inject()` needs no listening port and boots all registered plugins | fastify.dev, "Testing" guide | `test-writer`'s server-unit workflow |
| A disposable, real Postgres instance per test run, snapshot/restore for isolation | Testcontainers Node docs, `PostgreSqlContainer` | `test-writer`'s `.it.test.ts` guidance (via this repo's own `startPg` helper) |
| Diátaxis: structure a document by the reader's need (tutorial/how-to/reference/explanation); create a section only once it has real content | diataxis.fr | `doc-writer`'s routing table and "don't create sections just in case" rule |
| Docs-as-code: documentation lives with the code, in the same review flow | Write the Docs, "Docs as Code" | `doc-writer`'s placement inside `docs/`, `<module>/docs/`, and README link rows |
| ADRs record context/decision/consequences for an architectural decision | adr.github.io | `doc-writer`'s `docs/decisions/NNNN-<slug>.md` routing row |
| Mermaid diagrams render in a fenced ` ```mermaid ` block; the word `end` and unquoted special characters break flowcharts/sequence diagrams | GitHub diagram docs; Mermaid syntax reference | `doc-writer`'s diagram hard constraints |

Marked as this project's own design rather than sourced from the above: the `PASS`/`FAIL`/
`PARTIAL`/`NOT-VERIFIED` vocabulary and the `file:line`-evidence requirement in `plan-verifier`;
"never change production code to make a test pass, never weaken an assertion" in `test-writer`;
the `Shipped`/`Planned`/`Partial`/`Unverified` status header in `doc-writer`; the docs routing
table; the severity mapping for architectural violations in `architecture-reviewer`; the
assumption that subagents cannot spawn further subagents and that `hooks:` works in a
subagent's frontmatter (unverified — check `/agents` docs before relying on it).

`brainstorm`'s Options Brief format (diverge to 3–5 options of different kinds, then converge on a
comparison table and a recommended direction, never choosing for the user) is this project's own
design. `researcher.md` has no separate sources table — it follows the same repository conventions
(read-only Bash, no `Edit`/`Write`, no subagent spawning) established for the other agents,
documented inline in its own "Hard constraints" section.

## Codex portability

The same roster runs in OpenAI Codex. `.claude/agents/*.md` stays the source of truth; Codex-native files are **generated** by `node scripts/sync-codex-agents.mjs` (use `--check` to detect drift). See also the root [`AGENTS.md`](../../AGENTS.md#claude-code--codex-setup-portability).

| Claude Code | Codex |
|---|---|
| `.claude/agents/<name>.md` (frontmatter + prompt) | `.codex/agents/<name_snake>.toml` — `name`, `description`, `sandbox_mode`, `developer_instructions` |
| `tools:` allowlist (no `Write`/`Edit` = read-only) | `sandbox_mode = "read-only"` (no `Write`/`Edit` in source) or `"workspace-write"` |
| `model: sonnet` | omitted — inherits the Codex session model |
| `skills:` preloaded into context | listed in the agent's instructions; Codex loads them on demand from `.agents/skills/<name>/SKILL.md` |
| `.claude/skills/<name>/` | `.agents/skills/<name>` symlink to it |

Differences to know about:

- **Enforcement is different.** In Claude Code read-only comes from the missing tools; in Codex it comes from the sandbox, so shell writes (`>`, `tee`, `sed -i`) are blocked too, which is stricter than the prompt-only Bash convention above. Conversely, `workspace-write` cannot be limited to paths, so `planner` (`docs/plans/`), `test-writer` (tests) and `doc-writer` (docs) rely on their prompts, exactly as in Claude Code.
- **`plan-verifier` and tests.** In a read-only sandbox, re-running tests that write temp files may fail; the agent then reports `NOT-VERIFIED` instead of guessing.
- **`researcher` and the web.** External research needs web search enabled in the Codex session; otherwise it records the gap under "Could not find".
- **Tool names** in prompts (`Read`, `Grep`, `Edit`, …) are Claude Code's; every generated file starts with a short "Codex runtime notes" block mapping them to shell commands and `apply_patch`.
- **Invocation.** Ask explicitly, e.g. "Spawn the `researcher` agent to find where X is implemented".
