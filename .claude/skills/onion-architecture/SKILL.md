---
name: onion-architecture
description: Enforce and review module-local Onion Architecture in the Fastify/TypeScript backend under server/, including dependency direction, ports, adapters, composition-root wiring, migration, and architecture checks. Adds an explicit per-layer review checklist (including type-only imports) for reviewing code that pnpm architecture:check cannot reach.
metadata:
  version: 2.0.0
  scope: server
---

# Onion Architecture for `server/`

Use this skill for backend design, implementation, refactoring, and review in `server/`. The goal is architectural separation and low duplication, not performance tuning.

## Non-negotiable dependency direction

Dependencies point inward:

```text
inbound adapters (Fastify/HTTP/SSE/jobs)
        -> application (use cases, DTOs, ports)
        -> domain (rules, policies, value objects)

outbound adapters (Drizzle, GitHub, Git, LLM, filesystem)
        -> application ports and domain types

platform/infrastructure -> concrete composition root -> application/adapters
```

- `domain/` contains business rules and must not import Fastify, Drizzle, `Container`, Node adapters, SDKs, or environment/configuration.
- `application/` orchestrates use cases and defines ports. It may depend on domain and standard TypeScript types, but not on Fastify, Drizzle, concrete SDKs, or `Container`.
- `adapters/inbound/` translates transport input/output and calls application use cases. It owns schemas and transport concerns, not SQL or business decisions.
- `adapters/outbound/` implements application ports. Database queries, GitHub/LLM/Git/filesystem SDKs, and serialization stay here.
- `platform/` owns cross-cutting runtime concerns. `infrastructure/` owns concrete wiring. Only the composition root should assemble implementations.
- `vendor/shared/` contains stable cross-module contracts; do not use it as a dumping ground for feature logic.

## Required module shape

New and migrated modules use:

```text
server/src/modules/<module>/
  domain/                 # pure rules and types
  application/
    dto/                  # use-case input/output shapes
    ports/                # interfaces owned by the application layer
    use-cases/            # orchestration
  adapters/
    inbound/http/         # Fastify route plugins, Zod transport schemas
    outbound/persistence/ # Drizzle repositories
    outbound/providers/   # external SDK integrations where feature-specific
  index.ts                # module wiring/factory; no business logic
```

Keep cross-cutting adapters in `src/adapters/` only when they are genuinely reusable across modules. Do not duplicate SQL, DTO mapping, validation, or provider calls between routes and services.

## Implementation rules

1. Start from a use-case boundary and write its input/output contract.
2. Put interfaces for required external capabilities in `application/ports/`; the caller owns the abstraction.
3. Inject narrow ports into use cases. Do not pass the whole `Container` into application or domain code.
4. Keep Fastify handlers thin: parse/validate, obtain request context, call a use case, map the result/status.
5. Keep repositories focused on persistence and tenant scoping; do not put policy or HTTP response mapping in them.
6. Put transaction boundaries in the application use case and pass a transaction-capable port/repository when a workflow must be atomic.
7. Keep pure transformations in `domain/` or `application` helpers and test them without a database or server.
8. Register concrete implementations in the composition root (`src/platform/container.ts` or a dedicated infrastructure factory).
9. During migration, preserve public behavior and add compatibility exports only temporarily; do not create a second implementation.
10. For PR-list finding badges, preserve the existing invariant: count only the newest persisted review per agent, and never call reviewer-core/LLM during page rendering.

## Forbidden patterns

- route files importing `drizzle-orm` or `src/db/schema`;
- domain/application importing Fastify (e.g. `import type { FastifyRequest } from 'fastify'`, `import type { FastifyPluginAsync } from 'fastify'` — **type-only imports count**, not just runtime calls into Fastify);
- domain/application importing Drizzle or `src/db/*` directly (e.g. `import { eq } from 'drizzle-orm'`, `import { db } from '../db/client.js'`);
- domain/application importing a concrete provider SDK directly (e.g. `new OpenAI(...)`, `new Octokit(...)`) instead of depending on an `application/ports/` interface;
- domain/application importing a concrete filesystem or Git implementation (e.g. `import simpleGit from 'simple-git'`, raw `node:fs` calls) instead of a port;
- application code receiving the complete `Container`;
- a repository returning HTTP DTOs or throwing transport-specific errors;
- a shared utility used only by one feature;
- barrel exports that hide dependency direction;
- copying provider-specific logic into multiple use cases.

**Type-only imports are still violations.** An `import type { FastifyRequest } from 'fastify'` in `domain/` or `application/` has no runtime call, but it still couples that layer's public signatures to Fastify's types — if Fastify's API shape changes, the inner layer breaks. Flag it exactly like a runtime import.

## Review checklist (when `pnpm architecture:check` can't reach the code)

`pnpm architecture:check` only runs against committed files inside `server/`. When you're reviewing something it can't see — a diff, a pasted snippet, a fixture, code in a PR from another repo — you have no dependency-cruiser safety net, so do the check manually and mechanically instead of relying on recall of the prose rules above. For every file in the module, open it and check it against every row below; don't stop at the first thing that looks wrong, and don't skip a row because the file "looks fine" for that layer.

| File lives in | Its imports must never include | Including type-only imports? |
|---|---|---|
| `domain/` | `fastify`, `drizzle-orm`, `src/db/*`, `Container`, any provider SDK (`openai`, `octokit`, `@anthropic-ai/*`), `simple-git`/`node:fs`/concrete Git or filesystem code | Yes |
| `application/` (use-cases, ports, dto) | Same list as `domain/`, plus the whole `Container` (only narrow ports) | Yes |
| `adapters/inbound/http/` | `drizzle-orm`, `src/db/*` (queries must go through a use case, not straight to the DB) | Yes |
| `index.ts` | `export * from ...` (barrel exports) | — |
| any file | a same-named helper that duplicates logic already present in a sibling use-case/file (copy-paste provider calls, duplicated DTO shaping) | — |
| `src/adapters/*` (cross-cutting, outside any module) | for every file here, grep the whole repo for its imports — if only one feature module imports it, it's not actually cross-cutting and belongs inside that module instead | — |

A file passing every row above with no hits is clean. One hit on any row is one violation — report it with the file path and the matching row, even if it's "only" a type import.

## Required verification

From `server/` run:

```bash
pnpm architecture:check
pnpm typecheck
pnpm test
```

The architecture check is backed by `server/.dependency-cruiser.js` and must be updated whenever a new layer or intentional exception is introduced. Read `references/migration.md` for the migration order and `references/sources.md` for the research basis and links.

Current migration baseline: the `pulls` HTTP adapter has been extracted into application use-cases and outbound persistence. Keep the dependency-cruiser HTTP/database boundary enabled; future changes must preserve this split.
