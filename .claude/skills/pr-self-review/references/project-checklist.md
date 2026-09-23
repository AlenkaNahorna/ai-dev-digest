# DevDigest project checklist

Use only the sections whose files are present in the diff.

## Frontend

- Keep route entrypoints thin and put feature behavior in the owning feature.
- Preserve React Server Components by default; keep `use client` narrow.
- Keep API data in the established TanStack Query path and use typed query keys.
- Do not add barrel exports or duplicate shared contracts.
- Keep component tests behavior-focused with mocked network boundaries.

## Backend

- Validate route params and bodies with Zod before handlers run.
- Preserve authentication, workspace, and ownership checks at the server boundary.
- Keep HTTP adapters, application/domain logic, and outbound adapters separated.
- Preserve DI seams and avoid direct infrastructure calls from domain logic.
- Do not auto-migrate on boot; migrations are append-only and manually applied.
- Use the canonical shared contracts and keep API fields/contracts consistent.

## Database

- Check migration safety, rollback/forward compatibility, constraints, indexes,
  timestamp types, and data backfill behavior.
- Review query changes for workspace isolation and unbounded or N+1 access.
- Do not rewrite migration history or hand-edit lock files.

## Review engine

- Preserve deterministic grounding after the LLM step.
- Do not make UI aggregation depend on another LLM call.
- Keep persisted findings and historical review semantics distinct.

## Tests

- Match test type to the changed boundary.
- Unit tests must remain hermetic; integration tests may use PostgreSQL.
- E2E flows must use deterministic URL/text/role locators and seeded fixtures.
- Report missing tests as advisory unless the changed invariant is explicitly
  required by repository policy.
