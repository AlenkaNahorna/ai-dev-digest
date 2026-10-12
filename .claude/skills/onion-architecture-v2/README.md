# Onion Architecture (v2)

Version: `2.0.0` — supersedes `onion-architecture@1.0.0`

This skill governs the architecture of backend modules in `server/`. It applies Onion Architecture at module boundaries while keeping Fastify, Drizzle, external SDKs, and runtime wiring in outer layers.

**v2 changes** (from eval findings against `onion-architecture` v1): the "Forbidden patterns" compound bullet was split into explicit per-technology bullets, type-only imports (e.g. `import type { FastifyRequest } from 'fastify'`) are now called out as violations in their own right, and a new "Review checklist" section gives a mechanical per-layer table to use when `pnpm architecture:check` can't reach the code being reviewed (diffs, snippets, fixtures). A follow-up fix added an explicit checklist row for `src/adapters/*` utilities that are only consumed by one feature module — the first version of the checklist table narrowed attention away from that prose rule and caused a regression on an eval it previously passed.

## Contents

- [SKILL.md](SKILL.md) — operational rules for implementation and review.
- [references/migration.md](references/migration.md) — project migration map and incremental checklist.
- [references/sources.md](references/sources.md) — sources used to create the skill.

The executable enforcement is [server/.dependency-cruiser.js](/Users/olena.nahorna/Desktop/ai-dev-digest/server/.dependency-cruiser.js), invoked by `pnpm architecture:check`.
