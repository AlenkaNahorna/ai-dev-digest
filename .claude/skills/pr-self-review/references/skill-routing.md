# Skill routing

Use the file path, language, imports, and changed symbols together. Path rules
are defaults, not proof: a server action in `client/` remains server-side code,
and a shared contract must be reviewed as a cross-cutting boundary.

## Repository skill map

| Changed area | Skills to consider |
| --- | --- |
| `client/src/app/**`, `client/src/features/**`, `client/src/components/**`, React/TSX, Tailwind | `ui-frontend-architecture`, `next-best-practices`, `react-best-practices` |
| Client component or hook tests | `react-testing-library`, plus the applicable frontend skill |
| `server/src/modules/**`, Fastify plugins/routes, HTTP handlers | `fastify-best-practices`, `onion-architecture`, `security`, `zod` |
| `server/src/modules/**/domain/**`, application services, ports/adapters | `onion-architecture`, `typescript-expert`, plus domain-specific skills |
| `server/src/db/**`, Drizzle schema, migrations, SQL, indexes | `drizzle-orm-patterns`, `postgresql-table-design`, `security` when access/data exposure changes |
| `server/src/vendor/shared/**`, API contracts, request/response schemas | `zod`, `typescript-expert`, `security` when authorization or sensitive data changes |
| Auth, workspace membership, secrets, uploads, external input, GitHub tokens | `security` plus the domain skill for the touched layer |
| `reviewer-core/**`, review pipeline, grounding, findings | `typescript-expert`, `security` when prompt/data boundaries change; preserve grounding invariants |
| `e2e/**`, browser flows | `react-testing-library` where component behavior is involved; inspect `e2e/AGENTS.md` and deterministic flow rules |
| Mermaid diagrams or architecture documentation | `mermaid-diagram` only when the changed artifact is actually a Mermaid diagram |

## Non-matches

Do not run frontend architecture checks on server-only files, database-only
files, lock files, generated output, or documentation unrelated to UI.
Do not run database skills on a presentation-only UI change. Do not run a
template/document skill merely because a Markdown file changed.

## Classification edge cases

- `use server`, Server Actions, route handlers, and server-only imports require
  both frontend boundary review and backend/security review when they cross the
  client/server boundary.
- Changes under `client/src/vendor/shared` must be checked for symlink/canonical
  source violations.
- A migration and its application/service changes form one review unit.
- Renames must be reviewed under both old and new path categories.
- Deleted files require checking imports, routes, contracts, and tests that may
  still reference them.
- If no skill covers a category, emit `uncovered` and identify the missing
  capability instead of silently passing it.
