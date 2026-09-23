# Onion Architecture

Version: `1.0.0`

This skill governs the architecture of backend modules in `server/`. It applies Onion Architecture at module boundaries while keeping Fastify, Drizzle, external SDKs, and runtime wiring in outer layers.

## Contents

- [SKILL.md](SKILL.md) — operational rules for implementation and review.
- [references/migration.md](references/migration.md) — project migration map and incremental checklist.
- [references/sources.md](references/sources.md) — sources used to create the skill.

The executable enforcement is [server/.dependency-cruiser.js](/Users/olena.nahorna/Desktop/ai-dev-digest/server/.dependency-cruiser.js), invoked by `pnpm architecture:check`.
