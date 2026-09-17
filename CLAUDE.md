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

- `./scripts/dev.sh` — Launch everything (Postgres + API `:3001` + Web `:3000`)
- `pnpm dev` (each package) — Run in dev mode
- `pnpm build` / `pnpm start` — Production
- `pnpm test` — Run test suite
- `pnpm typecheck` — Type check
- `pnpm db:migrate` (server) — Apply migrations
- `pnpm db:seed` (server) — Load demo data

## Project Structure

| Folder | Package | Role | Port |
|--------|---------|------|------|
| `server/` | `@devdigest/api` | REST API + repo indexer (repo-intel) | 3001 |
| `client/` | `@devdigest/web` | Next.js studio UI | 3000 |
| `reviewer-core/` | `@devdigest/reviewer-core` | Review engine (diff → LLM → findings) | — |
| `e2e/` | `@devdigest/e2e` | Browser e2e tests (deterministic) | — |
| `server/src/vendor/shared` | `@devdigest/shared` | Zod contracts (all packages) | — |

## Key Rules

- **Stack rules**: No barrel exports in modules; paths aliases only (no published npm packages)
- **Backend**: All routes must validate input with Zod; drizzle migrations are gated by migration journal
- **Frontend**: React Server Components in Next.js; TailwindCSS 4 for styling
- **Testing**: `*.it.test.ts` = integration (Postgres); others = unit (hermetic)
- **Database**: Postgres runs in Docker; migrations via `drizzle-kit`; never auto-migrate on boot

## Do Not Touch

- `.github/workflows/` — CI gated by GitHub Actions
- `turbo.json` — Build orchestration
- `docker-compose.yml` — Only Postgres config (use `docker compose` CLI)
- Migration journal (`server/src/db/migrations/`) — Only add new migrations, never rewrite history

## Links & References

**Architecture & Design**:
- [System Architecture](docs/agent-prompts) — Agent prompts & system design decisions
- [Server Architecture](server/README.md) — API routes, repo-intel, db schema
- [Client UI Map](client/README.md) — Page routes, component structure
- [Review Engine](reviewer-core/README.md) — Review pipeline, LLM integration, grounding gate
- [E2E Tests](e2e/README.md) — Deterministic test flows

**Per-Module Docs**:
- [Server Module](server/CLAUDE.md) — Fastify, database, indexer
- [Client Module](client/CLAUDE.md) — Next.js, React, UI patterns
- [Reviewer Core Module](reviewer-core/CLAUDE.md) — LLM integration, findings
- [E2E Module](e2e/CLAUDE.md) — Test harness, flows

**Testing & Deployment**:
- [TESTING.md](TESTING.md) — Test strategy, CI workflows, split by package
- [Troubleshooting](README.md#troubleshooting) — Common errors and fixes

## Session Protocol

### 🟢 BEFORE You Start Any Work

**MANDATORY**: Read relevant ENGINEERING-INSIGHTS.md **before writing any code**. This prevents context loss and repeated mistakes.

**Step 1: Identify the module**
- API routes / database / indexer? → `server/ENGINEERING-INSIGHTS.md`
- React / Next.js / UI / components? → `client/ENGINEERING-INSIGHTS.md`
- Review engine / LLM / grounding? → `reviewer-core/ENGINEERING-INSIGHTS.md`
- E2E tests / flows / browser? → `e2e/ENGINEERING-INSIGHTS.md`
- General / architecture / gotchas? → `ENGINEERING-INSIGHTS.md` (root)

**Step 2: Summarize top 3 entries (FORCED)**

You MUST tell me the top 3 most relevant entries from that file **before proceeding**. 

Example:
```
"I've read server/ENGINEERING-INSIGHTS.md. Top 3 relevant to your task:

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

**Use `/engineering-insights` to capture learnings.** Quality gate:

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

**CRITICAL**: Do not skip this step. If insights aren't written, they're lost to future sessions.

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
- **CONDITIONAL**: Module CLAUDE.md auto-loads when you touch code in that folder
- **EXPLICIT**: Read relevant `ENGINEERING-INSIGHTS.md` (before work; summarize top 3)
- **EXPLICIT**: Use `/engineering-insights` command to capture learnings (end of session)

**During work**:
- **LAZY**: Use skills like `/fastify-best-practices`, `/react-best-practices`, `/drizzle-orm-patterns` on-demand

**No silent loading**: Summaries force active reading, not passive context loading.
