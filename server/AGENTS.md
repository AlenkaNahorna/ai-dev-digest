# Server Module — @devdigest/api

Fastify API + Drizzle ORM + PostgreSQL. Imports repos, indexes them with `repo-intel`, runs reviews via `@devdigest/reviewer-core`, and persists agents/findings.

## Stack

- **Framework**: Fastify 5 (`@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit`, `fastify-sse-v2`)
- **Database**: Drizzle ORM over PostgreSQL 16 + pgvector
- **Schema**: Zod contracts from canonical `src/vendor/shared` drive both request validation & response serialization (via `fastify-type-provider-zod`); the client consumes this source through a symlink.
- **LLM Adapters**: OpenAI, Anthropic, OpenRouter (swappable; injected via DI container)
- **Indexer**: `repo-intel` module (symbol extraction + import graph)

## Commands

- `pnpm dev` — Dev server `:3001` (hot reload via tsx watch)
- `pnpm build` — TypeScript → `dist/`
- `pnpm start` — Run built server
- `pnpm db:migrate` — Apply migrations (manual; NOT auto on boot)
- `pnpm db:seed` — Load demo data (idempotent)
- `pnpm db:generate` — Regenerate Drizzle types
- `pnpm test` — Unit tests (no DB needed)
- `pnpm test:integration` — Tests with real Postgres (testcontainers)
- `pnpm lint` — Server lint/static-analysis command; use `pnpm typecheck` as the enforced check until ESLint is configured.

## Key Rules

- **No auto-migration**: Migrations are manual only. Always run `pnpm db:migrate` after pulling changes
- **Validation is schema-first**: All routes declare Zod `params`/`body` schemas; invalid input is rejected with `422` before handler runs
- **Rate limiting**: Global 120/min; expensive endpoints (e.g. `POST /pulls/:id/review`) have tighter caps
- **Authentication boundary**: every request context must resolve a user, workspace, and `workspace_members` membership. Production refuses the local no-auth provider; tests must cover cross-workspace access as 403.
- **Secrets**: Stored in `~/.devdigest/secrets.json` (mode 0600), never in git or DB. Keys can be set via Settings UI at runtime
- **Test split**: `*.it.test.ts` = integration (Postgres via testcontainers); others = unit (hermetic)

## Architecture

### Request flow
```
HTTP request → plugins (helmet, cors, rate-limit, SSE) 
            → route Zod validation (422 if invalid)
            → inbound adapter (modules/<name>/adapters/inbound/http/routes.ts)
            → service (e.g. ReviewService)
            → DI container → adapters (LLM, GitHub, git, secrets, ast-grep)
            → Postgres (Drizzle)
```

### Modules (src/modules/)

Each module is a self-contained plugin. HTTP entrypoints live under
`adapters/inbound/http/`; SQL repositories live under
`adapters/outbound/persistence/`; application/domain code must depend inward:

| Module | Routes | Role |
|--------|--------|------|
| `repos/` | `GET /repos`, `POST /repos`, `GET /repos/:id/index-state` | Repo CRUD, repo-intel status |
| `pulls/` | `GET /pulls/:id`, `GET /pulls/:id/comments` | PR data from GitHub |
| `reviews/` | `POST /pulls/:id/review`, `GET /findings/:id/(accept\|dismiss)` | Run review, persist findings |
| `agents/` | `GET /agents`, `POST /agents`, `GET /agents/:id` | Agent CRUD (system prompt + model) |
| `runs/` | `GET /runs/:id/trace`, `GET /runs/:id/events` | Stream review run traces (SSE) |
| `polling/` | `GET /repos/:id/poll` | Long-poll repo indexing status |

(Course lessons add: `skills`, `memory`, `eval`, `blast`, `ci`, `plugins`, …)

The enforced rules and migration workflow are documented in
`.claude/skills/onion-architecture/SKILL.md`. Run `pnpm architecture:check`
before opening a backend PR.

## Database

### Schema (src/db/schema.ts)

Defined with Drizzle; tables include:
- `repos`, `pulls`, `findings`, `reviews` (core)
- `agents` (reviewer config)
- `skills`, `memory`, `eval_results`, `blast_metadata`, `ci_hooks`, `plugins` (pre-allocated for lessons)

### Migrations (src/db/migrations/)

One file per migration (`0000_*.sql`, `0001_*.sql`, …). Migration journal tracks applied migrations. **Never rewrite or edit past migrations.**

To add a new migration:
```bash
pnpm db:generate   # Drizzle detects schema changes
# Review generated migration in src/db/migrations/
pnpm db:migrate    # Apply
```

## Adapters (src/adapters/)

Dependency injection container allows swapping implementations:

| Adapter | Prod | Test |
|---------|------|------|
| `llm/` | OpenAI, Anthropic, OpenRouter | MockLLMProvider |
| `github/` | Octokit (GitHub API) | MockGitHubClient |
| `git/` | simple-git (clone, diff) | MockGitClient |
| `astgrep/` | @ast-grep/napi (symbol extraction) | MockAstGrepClient |
| `secrets/` | LocalSecretsProvider (`~/.devdigest/`) | MockSecretsProvider |
| `tokenizer/` | js-tiktoken | Stubbed |

## Key Files

- `src/server.ts` — Fastify app entry; plugin registration
- `src/platform/config.ts` — Loads config (all secrets optional)
- `src/platform/container.ts` — DI container setup
- `src/modules/index.ts` — Static module registration
- `src/modules/repo-intel/` — Symbol indexing + import graph (fed to reviewer)
- `.env.example` — Template for local secrets (API key, GitHub token)

## Related Documentation

### Read When

- DI, adapters, and request flow: [docs/architecture.md](docs/architecture.md)
- Review/cost/findings behavior: [specs/review-flow.md](specs/review-flow.md)

- [API map & routes](README.md#api-map) — Full endpoint list
- [Request & DI flow diagram](README.md#request--di-flow) — Request lifecycle
- [Testing strategy](../TESTING.md) — Unit vs integration split, CI workflows
- [Root AGENTS.md](../AGENTS.md) — Project structure, key rules

## Session Protocol — Server Module

### 🟢 BEFORE You Start

**Read server/INSIGHTS.md** and summarize the top 3 entries relevant to your task:
- Working on routes? → Check "What Doesn't Work" (validation patterns)
- Working on database? → Check "Recurring Errors & Fixes" (migrations, queries)
- Working on adapters? → Check "Codebase Patterns" (DI container, secrets)

**Example**: "I'm adding a new route for `/repos/:id/status`. Top 3 relevant insights:
1. All routes must validate input with Zod before handler runs
2. Use DI container for adapters (don't hardcode LLM provider)
3. Rate limiting is global 120/min; expensive routes get tighter caps"

### 🔴 END OF SESSION

Write insights **only if substantial**. Check ENGINEERING-INSIGHTS.md first for duplicates.

**Common scenarios:**

✅ **Write**: "Promise.all() on 100+ symbols times out; use Promise.allSettled() + batch 10"
❌ **Skip**: "Migrations are important" (already documented)

✅ **Write**: "Secrets must be in ~/.devdigest/secrets.json (mode 0600); never .env or DB"
❌ **Skip**: "Be careful with keys" (too vague)

## Lazy-Load Context

- **Skills**: `/fastify-best-practices`, `/drizzle-orm-patterns`, `/postgresql-table-design`, `/engineering-insights`
- **Module insights**: See `INSIGHTS.md` (append-only learnings from prior sessions)
- **Related modules**: See [client/AGENTS.md](../client/AGENTS.md) (API consumer), [reviewer-core/AGENTS.md](../reviewer-core/AGENTS.md) (review engine)
