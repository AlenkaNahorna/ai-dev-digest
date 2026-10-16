# Onion Architecture

Version: `2.0.0`

This skill governs the architecture of backend modules in `server/`. It applies Onion Architecture at module boundaries while keeping Fastify, Drizzle, external SDKs, and runtime wiring in outer layers.

**2.0.0 changes** (from eval findings against 1.0.0): the "Forbidden patterns" compound bullet was split into explicit per-technology bullets, type-only imports (e.g. `import type { FastifyRequest } from 'fastify'`) are called out as violations in their own right, and a new "Review checklist" section gives a mechanical per-layer table for code `pnpm architecture:check` can't reach (diffs, snippets, fixtures), including a row for `src/adapters/*` utilities consumed by only one feature module.

## Contents

- [SKILL.md](SKILL.md) — operational rules for implementation and review.
- [references/migration.md](references/migration.md) — project migration map and incremental checklist.
- [references/sources.md](references/sources.md) — sources used to create the skill.

The executable enforcement is [server/.dependency-cruiser.js](/Users/olena.nahorna/Desktop/ai-dev-digest/server/.dependency-cruiser.js), invoked by `pnpm architecture:check`.
