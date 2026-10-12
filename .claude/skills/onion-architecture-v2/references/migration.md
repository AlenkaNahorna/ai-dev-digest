# Server migration map

## Target

Each feature under `server/src/modules/` owns its domain rules, application use cases and ports, inbound HTTP adapters, and outbound persistence/provider adapters. The platform composition root supplies implementations.

## Existing module mapping

| Current area | Target responsibility |
|---|---|
| `modules/*/routes.ts` | `adapters/inbound/http/` |
| `modules/*/service.ts` | `application/use-cases/` after narrowing dependencies |
| `modules/*/repository*.ts` | `adapters/outbound/persistence/` |
| `modules/*/helpers.ts`, pure status/derivation | `domain/` or `application/dto/` |
| `src/adapters/*` | shared outbound adapters implementing feature ports |
| `src/platform/container.ts` | composition root; concrete wiring only |
| `src/db/*` | infrastructure persistence implementation |

## Migration order

1. Add the use-case contract and port interfaces.
2. Extract direct SQL from routes into an outbound repository.
3. Move orchestration into an application use case with narrow injected ports.
4. Leave the route as a transport adapter and keep response behavior unchanged.
5. Move pure rules and mapping out of the route/service into domain/application code.
6. Wire the use case in the composition root and delete compatibility wrappers when callers are migrated.
7. Run `pnpm architecture:check`, `pnpm typecheck`, and focused tests before the full suite.

The remaining high-value migration work is to remove direct Drizzle access from the `polling`, `workspace`, and `settings` HTTP adapters, followed by services that receive the whole `Container`. The `pulls` adapter has already been migrated to application use-cases and outbound persistence.

## Non-regression constraints

- Keep workspace/tenant scoping in every repository method.
- Keep transactions at the use-case boundary.
- Do not move migrations or rewrite the Drizzle journal.
- Preserve the PR-list newest-review aggregation invariant documented in `server/INSIGHTS.md`.
