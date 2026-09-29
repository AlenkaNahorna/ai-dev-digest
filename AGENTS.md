# DevDigest — AI Dev Digest

Local-first AI pull-request review tool. Course starter template with end-to-end PR review workflow via LLM.

## Stack

- **Runtime**: Node 22+, TypeScript 5.7
- **API**: Fastify 5 + Drizzle ORM (PostgreSQL 16)
- **Web**: Next.js 15 (React 19) + TailwindCSS 4
- **Engine**: @devdigest/reviewer-core (LLM review logic)
- **Database**: PostgreSQL 16 + pgvector
- **Testing**: Vitest + jsdom + agent-browser

## Commands

- `./scripts/dev.sh` — Launch everything (Postgres + API `:3001` + Web `:3005`)
- `pnpm dev` (each package) — Run in dev mode
- `pnpm build` / `pnpm start` — Production
- `pnpm test` — Run test suite
- `pnpm typecheck` — Type check
- `pnpm lint` — Run the package lint/static-analysis command when available; in packages without a configured linter, `pnpm typecheck` is the enforced static check.
- `pnpm db:migrate` (server) — Apply migrations
- `pnpm db:seed` (server) — Load demo data

## Project Structure

| Folder | Package | Role | Port |
|--------|---------|------|------|
| `server/` | `@devdigest/api` | REST API + repo indexer (repo-intel) | 3001 |
| `client/` | `@devdigest/web` | Next.js studio UI | 3005 |
| `reviewer-core/` | `@devdigest/reviewer-core` | Review engine (diff → LLM → findings) | — |
| `e2e/` | `@devdigest/e2e` | Browser e2e tests (deterministic) | — |
| `server/src/vendor/shared` | `@devdigest/shared` | Canonical Zod contracts; client consumes it through a symlink | — |

## Key Rules

- **Stack rules**: No barrel exports in modules; paths aliases only (no published npm packages)
- **Backend**: All routes must validate input with Zod; drizzle migrations are gated by migration journal
- **Frontend**: React Server Components in Next.js; TailwindCSS 4 for styling
- **Testing**: `*.it.test.ts` = integration (Postgres); others = unit (hermetic)
- **Database**: Postgres runs in Docker; migrations via `drizzle-kit`; never auto-migrate on boot
- **Shared contracts**: `server/src/vendor/shared` is canonical; `client/src/vendor/shared` must remain a symlink and must not become a second copy.

## Naming Conventions

- TypeScript variables and functions use `camelCase`; types, interfaces, React components, and Zod schemas use `PascalCase`.
- Database columns and API JSON fields use `snake_case`; Drizzle properties remain `camelCase` and map explicitly at the boundary.
- React components are named after the rendered concept (`FindingsModal`, `ReviewRunAccordion`); hooks start with `use` and route segments stay lowercase.
- Files use lowercase kebab-case for modules and tests (`review-flow.md`, `pulls-status.test.ts`); component files may use the component's PascalCase name when colocated with UI.
- Shared policy constants use `UPPER_SNAKE_CASE`; IDs and timestamps use `*_id` and `*_at` in database/API contracts.

## Do Not Touch

- `.github/workflows/` — CI gated by GitHub Actions
- `turbo.json` — Build orchestration
- `docker-compose.yml` — Only Postgres config (use `docker compose` CLI)
- Migration journal (`server/src/db/migrations/`) — Only add new migrations, never rewrite history
- Lock files (`pnpm-lock.yaml`, `package-lock.json`) — Do not edit by hand or regenerate during feature work.

## Claude Code + Codex setup (portability)

The repo works in both tools from one source of truth in `.claude/`:

| What | Claude Code reads | Codex reads | How they are kept in sync |
|------|-------------------|-------------|---------------------------|
| Project rules | `CLAUDE.md` (symlink → this file) | `AGENTS.md` (root + nested per-module) | one file |
| Skills | `.claude/skills/<name>/` | `.agents/skills/<name>/` | relative symlinks → `.claude/skills/<name>` |
| Subagents (`researcher`, `planner`, `implementer`, `test-writer`, `architecture-reviewer`, `plan-verifier`, `doc-writer`) | `.claude/agents/*.md` | `.codex/agents/*.toml` (snake_case names, e.g. `plan_verifier`) | **generated** from the `.md` files |

- After changing `.claude/agents/*.md` or adding/removing a skill, run `node scripts/sync-codex-agents.mjs` and commit the result. `node scripts/sync-codex-agents.mjs --check` exits non-zero when something is out of date. **Never edit `.codex/agents/*.toml` by hand.**
- Read-only agents (`researcher`, `architecture_reviewer`, `plan_verifier`) get `sandbox_mode = "read-only"` in Codex, which Codex enforces; the others get `workspace-write`, where path limits (tests only, docs only, `docs/plans/` only) remain conventions the agent must follow.
- Codex starts a subagent only when asked, by name: e.g. "Spawn the `planner` agent to plan X, then the `implementer` agent to execute the plan." Codex agents inherit the session's model (the Claude `model: sonnet` alias is not carried over).
- Details and caveats: [.claude/agents/README.md](.claude/agents/README.md#codex-portability).

## Links & References

**Architecture & Design**:
- [System Architecture](docs/agent-prompts) — Agent prompts & system design decisions
- [Server Architecture](server/README.md) — API routes, repo-intel, db schema
- [Client UI Map](client/README.md) — Page routes, component structure
- [Review Engine](reviewer-core/README.md) — Review pipeline, LLM integration, grounding gate
- [E2E Tests](e2e/README.md) — Deterministic test flows
- [PR Self Review](.claude/skills/pr-self-review/SKILL.md) — mandatory workflow for reviewing the current Git diff before opening or updating a pull request

Each module also has package-specific architecture/spec documents. Read the relevant
`docs/*.md` and `specs/*.md` before changing that package's behavior.

**Per-Module Docs**:
- [Server Module](server/AGENTS.md) — Fastify, database, indexer
- [Client Module](client/AGENTS.md) — Next.js, React, UI patterns
- [Reviewer Core Module](reviewer-core/AGENTS.md) — LLM integration, findings
- [E2E Module](e2e/AGENTS.md) — Test harness, flows

**Testing & Deployment**:
- [TESTING.md](TESTING.md) — Test strategy, CI workflows, split by package
- [Troubleshooting](README.md#troubleshooting) — Common errors and fixes

## Session Protocol

### 🟢 BEFORE You Start Any Work

**MANDATORY**: Read the relevant module `INSIGHTS.md` **before writing any code**. This prevents context loss and repeated mistakes.

**Step 1: Identify the module**
- API routes / database / indexer? → `server/INSIGHTS.md`
- React / Next.js / UI / components? → `client/INSIGHTS.md`
- Review engine / LLM / grounding? → `reviewer-core/INSIGHTS.md`
- E2E tests / flows / browser? → `e2e/INSIGHTS.md`
- General / architecture / gotchas? → `INSIGHTS.md` (root)

**Step 2: Summarize top 3 entries (FORCED)**

You MUST tell me the top 3 most relevant entries from that file **before proceeding**. 

Example:
```
"I've read server/INSIGHTS.md. Top 3 relevant to your task:

1. What Doesn't Work: Auto-migration on boot hides broken migrations. 
   Always manual (pnpm db:migrate) to catch issues early.

2. Codebase Pattern: DI container for adapters — prod uses real LLM, 
   tests use MockLLMProvider. One code path, swappable.

3. Recurring Error & Fix: 'relation ... does not exist' means migrations 
   weren't applied. Always run pnpm db:migrate after pulling."
```

**Why**: Proves you read (not silent loading), internalizes learnings, catches gaps.

**Step 3: Start work with full context**

You now have:
- ✅ Patterns to apply
- ✅ Mistakes to avoid
- ✅ Decisions made and why
- ✅ Common errors and fixes
- ✅ No context loss

### 🟡 DURING Your Work

- Observe what works and what breaks
- Flag interesting patterns mentally
- Note unexpected behaviors
- Keep it informal; don't write yet

### 🔴 END OF SESSION — Write Only If Substantial

**Use the `engineering-insights` skill to capture learnings** (Claude Code: `/engineering-insights`; Codex: `$engineering-insights` or just ask for it by name). Quality gate:

**1. Not obvious** — Would every developer reading code know this?
   - ❌ Bad: "Promises are tricky"
   - ✅ Good: "Promise.all() > 100 items times out; use Promise.allSettled() + batch 10"

**2. Actionable** — Can someone apply Monday morning without questions?
   - ❌ Bad: "Be careful with state"
   - ✅ Good: "State checkout-flow always uses Zustand (cartStore.ts), never useState; 3 components share"

**3. Not duplicate** — Check ENGINEERING-INSIGHTS.md first
   - If exists → SKIP
   - If similar but needs refinement → Add dated **CLARIFICATION** note
   - If new → APPEND-ONLY (never overwrite)

**Format**: `- [DATE] **CATEGORY**: Finding (file:line proof)`

**Cadence**: Capture after sessions >30 min with problem/solution/discovery; skip trivial fixes.

**File locations**: `ENGINEERING-INSIGHTS.md` at the repository root is the central file for cross-cutting findings; each module's `INSIGHTS.md` keeps module-specific findings. If the skill or command is unavailable, append the entry manually with the same format—do not skip the end-of-session capture.

**CRITICAL**: Do not skip this step. If insights aren't written, they're lost to future sessions.

### Repository-local skills

Before implementation, review, or PR work, enumerate repository-local skills:

- `.claude/skills/*/SKILL.md`
- `.agents/skills/*/SKILL.md`
- any skills explicitly referenced by the task

Repository-local skills are part of the project contract and must not be ignored
because they are absent from the globally available skill catalog.

For code review or before opening/updating a PR, always use
`.claude/skills/pr-self-review/SKILL.md`.

The final review report must list:

- skills used;
- skills skipped;
- unavailable skills;
- uncovered file groups.

### When to Write ✅

- "Promise.all() > 100 items times out; use allSettled() + batch 10" (specific threshold + fix)
- "Found bug in X; fixed it with Y; here's why" (teaches future self)
- "State shared across 3 components must use Zustand, not useState" (specific pattern, learned hard way)
- "GitHub webhooks must verify HMAC before parsing payload" (unexpected requirement)

### When to Skip ❌

- "Promises are tricky" (obvious)
- "Be careful with state" (vague, not actionable)
- "Zod is useful" (already in stack/README)
- "Migrations are important" (already documented)
- "Use TypeScript" (general knowledge)

## Context Loading Strategy

**BEFORE any task**:
- **CONDITIONAL**: Module AGENTS.md auto-loads when you touch code in that folder
- **EXPLICIT**: Read relevant `INSIGHTS.md` (before work; summarize top 3)
- **EXPLICIT**: Use the `engineering-insights` skill to capture learnings (end of session; Codex: `$engineering-insights`)

**During work**:
- **LAZY**: Use skills like `fastify-best-practices`, `react-best-practices`, `drizzle-orm-patterns` on-demand (Claude Code: `/name`; Codex: `$name` or ask by name)
- **REPOSITORY-LOCAL**: Discover and load skills from `.claude/skills/` and `.agents/skills/` before relying on the global skills catalog

**No silent loading**: Summaries force active reading, not passive context loading.
