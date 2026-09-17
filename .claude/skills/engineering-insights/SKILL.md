---
name: engineering-insights
description: Captures and reuses non-obvious engineering insights across every session for this project. MUST be invoked at the start of every session — read the "Captured Insights" section below and summarize the top 3 entries relevant to the task before starting work. MUST be invoked again at the end of every session — check whether anything discovered is substantial, not already recorded, and not obvious, and if so append it (never overwrite). Covers: working patterns, antipatterns/dead ends, codebase conventions, tool/library quirks, recurring errors + fixes, decisions + rationale, and open questions.
---

# engineering-insights

This skill is the project's append-only memory of non-obvious engineering learnings. It exists so a future session doesn't relearn what a past session already figured out.

## How to Use This Skill

**Every session, no exceptions:**

1. **At the start** — Read the "Captured Insights" section below. Summarize the top 3 entries relevant to the current task, out loud, before writing any code. This forces active reading instead of silent loading.
2. **During work** — Observe what works, what breaks, what surprises you. Don't write yet.
3. **At the end** — Decide whether anything is worth recording. Apply the quality gate below. If yes, re-read "Captured Insights" first to make sure it's not already there, then append.

### Quality Gate (all three must pass, or skip)

1. **Not obvious** — would any developer reading the code already know this?
   - ❌ "Promises can be tricky"
   - ✅ "Promise.all() on the ingest pipeline times out after 30 items — use Promise.allSettled() with batches of 10"
2. **Actionable** — can someone apply it cold, Monday morning, without asking questions?
   - ❌ "Be careful with async"
   - ✅ "Checkout flow state always goes through Zustand (cartStore.ts) — the cart is shared by 3 components"
3. **Not a duplicate** — check "Captured Insights" first. If it's already there, skip. If it's there but wrong/incomplete, add a dated clarification note instead of rewriting it.

### Entry Format

```
- [YYYY-MM-DD] **Category**: Finding, stated cold. Evidence: `file:line`.
```

Categories: What Works · What Doesn't Work · Codebase Patterns · Tool & Library Notes · Recurring Errors & Fixes · Decisions · Session Notes · Open Questions.

**Rules**: append-only (never edit or delete past entries); correct mistakes with a new dated note, not a rewrite; skip trivial sessions — not every session produces an entry.

---

## Captured Insights

_Empty. This section fills up as sessions discover things worth keeping. Append below, grouped by category, following the format above._

### What Works

### What Doesn't Work

### Codebase Patterns

- [2026-09-17] **Codebase Patterns**: `@devdigest/shared` Zod contracts are vendored as byte-identical copies in `server/src/vendor/shared/contracts/*` and `client/src/vendor/shared/contracts/*` — NOT symlinked. Adding/changing a field (e.g. `RunStats`, `RunSummary`, `PrMeta`) must be applied to both copies or client/server silently drift out of sync (each is its own compilation unit, so `tsc` in one package won't catch a missed edit in the other). Evidence: `server/src/vendor/shared/contracts/{trace,platform}.ts` vs `client/src/vendor/shared/contracts/{trace,platform}.ts`.
- [2026-09-17] **Codebase Patterns**: When a shared contract field is populated by more than one producer with different capabilities (e.g. `PrMeta` is both the raw GitHub-client return type AND the enriched `GET /repos/:id/pulls` response), make that field `.nullish()` (optional), not `.nullable()`/required — otherwise every place constructing the "raw" shape (mocks, GitHub adapter fixtures) fails typecheck for a field it never had data for. `PrMeta.score` already does this; `PrMeta.cost_usd` follows the same rule. Evidence: `server/src/vendor/shared/contracts/platform.ts` (`score`/`cost_usd`), `server/src/adapters/mocks.ts:138-157` (`MockGitHubClient.listPullRequests`).

### Tool & Library Notes

### Recurring Errors & Fixes

- [2026-09-17] **Recurring Errors & Fixes**: Adding a required field to a Zod-inferred contract type (`RunTrace`, `RunSummary`, …) breaks any test fixture typed against that type at COMPILE time, not runtime — `pnpm test` passes locally with stale mocks only if you also run `typecheck`. Grep for `: RunTrace =`, `: RunSummary`, `Partial<RunSummary>` factory helpers, etc. in `*.test.tsx` before assuming a contract change is "just an edit to one file". Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/RunTraceDrawer.test.tsx`, `.../RunHistory/RunHistory.test.tsx`, `server/test/contracts.test.ts` all needed a `cost_usd` fixture value when it became a required `RunStats`/`RunSummary` field.

### Decisions

- [2026-09-17] **Decisions**: `agent_runs.cost_usd` originally existed (from `0000_init.sql`) but was dropped in `0009_complex_runaways.sql` when main was reverted to the starter template ("revert: restore main to the starter state, homework belongs in forks"). Cost *computation* (`reviewer-core`'s `reviewPullRequest()`, all 3 LLM adapters, `server/src/adapters/llm/pricing.ts`) was never removed — only persistence/exposure. If a future task needs cost/pricing data again, check whether it's already computed upstream before rebuilding it.

### Session Notes

### Open Questions

---

## Research Collection

A collection of materials gathered while working on the *engineering-insights* skill (capture-learnings loop) for the course. Grouped by topic. Each entry includes: the core concept, key takeaways, and a link. This is background reading, not the live insights log above.

---

## 1. Key Guides on the Learnings Loop (Must-Read)

### MindStudio — Self-Learning AI Skill System with Learnings.md + Wrap-Up Skill
March 24, 2026. The most comprehensive practical guide. Read in full.
https://www.mindstudio.ai/blog/self-learning-ai-skill-system-learnings-md-wrap-up

What to include:
- **Ready-made file structure** (fixed sections): What Works · What Doesn't Work
· Codebase Patterns · Tool & Library Notes · Recurring Errors & Fixes ·
Session Notes (datestamped) · Open Questions.
- **Examples (vague vs. useful):** "Promises can be tricky" (bad) →
"Promise.all() on the ingest pipeline times out after 30 items—use
Promise.allSettled() with batches of 10" (good). "Be careful with async" →
"Always manage checkout flow state via Zustand (cartStore.ts), as the cart
is shared by 3 components."
- **Three ways to trigger wrap-up:** `/wrap-up` slash command
(.claude/commands/wrap-up.md), automatic hook (PostToolUse/Stop), manual
prompt. Conclusion: manual is unreliable—"if you skip the wrap-up, the system
doesn't learn."
- **Ready-made text for CLAUDE.md:** Session Context section ("before starting any
work, read Learnings.md… treat as high-confidence guidance") + End of Session
("run /wrap-up… Do not skip this step").
- **Common mistakes:** failing to run wrap-up consistently; overly generic entries;
file becoming too long (>200 entries—signal-to-noise ratio drops); conflicting
entries; skipping the "What Doesn't Work" section.
- **Team mode:** append-only in PRs, designated maintainer consolidates;
agreed-upon entry format; commit Learnings.md to the repo.
- **Cadence:** wrap-up after every session >30 min involving a problem,
solution, or discovery; skip trivial fixes. Quarterly review for cleanup.
- **FAQ:** The "wrap-up" could corrupt the database (if the LLM summarizes incorrectly) → LEARNINGS serve as a draft for review—a human spot-check; connection to RAG (it is essentially "manual RAG without infrastructure").

### MindStudio — How to Build a Learning Loop for Claude Code Skills
March 19, 2026.
https://www.mindstudio.ai/blog/how-to-build-learnings-loop-claude-code-skills

Key takeaways:
- Protocol in `CLAUDE.md` (Session Protocol): at the start — read `LEARNINGS.md` +
briefly summarize; at the end — identify patterns/mistakes, append, do not
overwrite (correct with a dated note).
- **Forced active reading:** "Before we begin, confirm you've read
`LEARNINGS.md` and summarize the top 3 most relevant points" — compels processing
rather than passive loading; it also serves as a sanity check that the file was actually read.
- `LEARNINGS` ≠ `CLAUDE.md` (different purposes); `LEARNINGS` ≠ chat replay (extract
insights, not the full history).

### MindStudio — Compounding Knowledge Loop in Claude Code
Mechanics of session lifecycle hooks + a self-updating database.
https://www.mindstudio.ai/blog/compounding-knowledge-loop-claude-code

Key takeaways:
- 5 types of hooks (`PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SubagentStop`);
for capturing knowledge, the most important is **Stop** (end of session).
- Problem statement: the agent exists within the context window, but nothing
persists after the session ends; "You repeat yourself constantly… make the same class of mistakes
as last week… institutional knowledge lives in your head, not the agent's."
- Basic example of a hook configuration in `.claude/settings.json`.

### MindStudio — Self-Learning Claude Code Skill with Learnings.md
Why the pattern works without RAG/vectors.
https://www.mindstudio.ai/blog/self-learning-claude-code-skill-learnings-md

Key takeaways: "just a file where the previous version of Claude left notes for the
current version to read"; Markdown is the right format (Claude reads/writes
it natively); long-context research shows that models utilize
structured context better than they reconstruct knowledge from scratch.

### MindStudio — Self-Evolving Claude Code Memory with Obsidian + Hooks
The stop-hook writes to an Obsidian vault via the Anthropic API.
https://www.mindstudio.ai/blog/self-evolving-claude-code-memory-obsidian-hooks

Key takeaways:
- Full stop-hook flow: script reads the session transcript from local storage →
sends it to Claude with an extraction prompt → receives structured insights → writes
Markdown to the vault → future sessions read it.
- **4 capture categories:** Patterns · Mistakes · Decisions · Context (each in
its own subfolder + auto-indexing). This forms the basis for our 4 categories.

### MindStudio — What Is Claude Code Auto-Memory
How the agent autonomously adds knowledge between sessions.
https://www.mindstudio.ai/blog/what-is-claude-code-auto-memory

Key takeaways: overview of the auto-memory mechanism; what to store (build/test commands,
conventions, architectural decisions, environment quirks); early review of entries
prevents the accumulation of errors.

---

## 2. Self-improving CLAUDE.md (related pattern)

### dev.to / Aviad Rozenhek — Self-Improving AI: One Prompt That Makes Claude Learn From Every Mistake
https://dev.to/aviad_rozenhek_cba37e0660/self-improving-ai-one-prompt-that-makes-claude-learn-from-every-mistake-16ek

Key takeaways:
- The meta-rule concept: "we have thousands of tokens of cognition at the start of
every session — why treat CLAUDE.md as static when we could turn it into a
self-improving system."
- Compounding: Session 1 — Claude makes 3 mistakes, you apply the prompt 3 times →
3 new rules; Session 2 — it reads the rules at the start, and those mistakes don't recur.
- Entry rules: lead with "why," use NEVER/ALWAYS, be concise, update the summary.

### dev.to / evoleinik — CLAUDE.md: Building Persistent Memory for AI Coding Agents
https://dev.to/evoleinik/claudemd-building-persistent-memory-for-ai-coding-agents-5322

Key takeaways (best quotes):
- "Add to Learnings: Prisma Accelerate has 5MB response limit — use select not
include" — example of a one-line entry.
- Workflow: mentally flag items during the session → add them after confirming the fix;
at the end: "Review this session and add any non-obvious findings… only if
genuinely useful"; monthly: remove fixed bugs / duplicates / obsolete info.
- **Compounding effect:** "After 3 months… the agent feels like a team member
who's been on the project for months, not a contractor starting fresh every
morning."
- Limitations: it is not a replacement for documentation; format optimized for LLMs (concise, declarative);
not a crutch for poor tooling (if the agent forgets how to run tests—perhaps
the test command is too long; fix the root cause).

---

## 3. Official from Anthropic

### Anthropic — Lessons from building Claude Code: How we use skills
2 weeks ago. Skills in active use within Anthropic (hundreds).
https://claude.com/blog/lessons-from-building-claude-code-how-we-use-skills

What to take:
- "Common misconception: skills are just markdown files. They're folders that can
include scripts, assets, data" supports our anatomy slide.
- **Dynamic hooks in skills:** A skill can register hooks that live only while
the skill is active, only this session — "for opinionated hooks you don't want always
on". Examples: /careful (blocks rm -rf, DROP TABLE, force-push), /freeze
(blocks Edit outside a specific folder during debugging).

### Anthropic — Skill authoring best practices
https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices

What to take (writing rules, also applicable to insights):
- description = discovery interface; include "what does" AND "when to apply";
always third person (injected into the system prompt).
- test on all models you will work with (Opus vs Haiku - different
detailing); names of skills are gerund form.
- skills act as additions to models — effectiveness depends on the base model.

---

## 4. Ready-made skill equivalents (implementation examples)

### glebis/claude-skills — retrospective skill
6 days ago. A ready-to-use session retrospective skill.
https://github.com/glebis/claude-skills

Key features: `/retrospective` (current session), `/retrospective today` (all sessions for the
day, multi-session mode), `/retrospective 2026-05-24` (specific date);
"reviews conversations, extracts learnings, updates skills"; "Use when: end of
work day to capture learnings across all sessions".

### mcpmarket — Lessons Learned (AI Development Retro)
https://mcpmarket.com/tools/skills/lessons-learned-retrospectives

Key features: parses build-summaries → proposes lessons → formats as LESSONS.md →
optionally updates CLAUDE.md; "enforces high quality standards… prevents generic
platitudes… focuses on actionable, transferable technical knowledge".

### mcpmarket — CLAUDE.md Lessons Manager
https://mcpmarket.com/tools/skills/claude-md-lessons-manager

Key features: automatic extraction from chat history + terminal output; session-end
reminders; **duplicate detection and rule consolidation** (to keep things lean).

### omega-memory / Omega (MCP) — Reddit draft with real-world experience
https://glama.ai/mcp/servers/@omega-memory/Omega/blob/.../docs/reddit-drafts.md

Key takeaways (real-world case from r/ClaudeAI): "6 months as a daily driver; biggest friction —
context loss, 10-15 mins per session re-explaining architecture, code preferences,
past debugging". Before/After: "We chose PostgreSQL for ACID, not Redis" — previously
had to explain this every time; now the agent starts already knowing the decision.

---

## 5. Related Topics (Context Management, Skill Code)

### MindStudio — Claude Code Skills: Code Scripts vs Markdown Instructions
April 1, 2026. Why scripts > markdown.
https://www.mindstudio.ai/blog/claude-code-skills-code-scripts-vs-markdown-instructions
Key takeaway: executable scripts cut token usage by up to 90% and make tasks more reliable—
reinforces the concept of "Capability Uplift" and the idea that "a code-based detector is more reliable than a model."

### MindStudio — Skills vs Hooks: difference and when to use each
April 30, 2026.
https://www.mindstudio.ai/blog/claude-code-skills-vs-hooks-difference
Key takeaway: "hooks aren't called by Claude — the system calls them"; three-level
memory (capture everything / curate what matters).

### MindStudio — Context Compounding Explained
https://www.mindstudio.ai/blog/claude-code-context-compounding-explained
Key takeaway: shorter, focused sessions = lower peak context usage; CLAUDE.md acts
as a fixed-size system input (it does not compound with the conversation history).

---

## 6. Ready-to-use skill structure for the course (synthesis of the above)

**Name:** `engineering-insights`. **Location:** `LEARNINGS.md` within the module
addressed by the task (`apps/client`, `apps/server`, `packages/reviewer-core`,
`packages/repo-intel`) — each has its own file. **Mode:** append-only.

**LEARNINGS.md Sections** (from MindStudio, adapted to 4 categories):
- What Works (Pattern) · What Doesn't Work (Mistake/antipattern) ·
Codebase Patterns + Tool/Library Notes (Context) · Decisions (decision +
rationale) · Recurring Errors & Fixes · Session Notes (datestamped) ·
Open Questions.

**Trigger:** dual — at task completion (wrap-up) + "capture as you go" for
non-obvious insights. Cadence: sessions >30 min involving a
problem/solution/discovery.

**Entry format:** date + category + essence + evidence (`file:line`).
Actionable "cold" (ready to use without extra context).

**Anti-banality:** the "if it were obvious to anyone reading the code, don't
write it" test. Vague vs. useful — examples from MindStudio.

**Control:** monthly prune (outdated = harmful); conflict resolution; limit
~200 entries or split into domain-specific files; `LEARNINGS` as a draft for
spot-checks; git versioning.

**Closing the loop (CLAUDE.md):**
- Session Context: "before work, read `LEARNINGS.md`; treat as high-confidence
guidance unless told otherwise."
- End of Session: "run `/engineering-insights` to update `LEARNINGS.md`; do not skip."
- Start-check (forcing a read): "confirm you've read `LEARNINGS.md` and
summarize the top 3 relevant points."

**Course arc:** L01 – we write a skill and see the effect, but also the unreliability of automatic triggering →
L06 – the "stop-hook" makes the capture automatic and foolproof (because "if it requires a human trigger, it won't happen consistently enough to be useful").
