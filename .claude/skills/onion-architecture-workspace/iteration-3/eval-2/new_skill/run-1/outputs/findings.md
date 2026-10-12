1. **server/src/modules/tags/application/use-cases/assign-tag.ts**: imports `type { Container }` from `platform/container.js` and accepts the whole `Container` as a parameter, which the skill explicitly forbids for `application/` ("plus the whole `Container` (only narrow ports)") — the use case should receive a narrow `TagRepositoryPort` instead.

2. **server/src/modules/tags/adapters/outbound/persistence/tag-repository.ts**: the repository's `assign` method returns a `TagResponseDto` (a snake_case HTTP-shaped object, `{ id, pull_id, name }`) instead of the domain/application `TagRow` type declared in its own `TagRepositoryPort`, violating the forbidden pattern "a repository returning HTTP DTOs."

3. **server/src/modules/tags/adapters/outbound/persistence/tag-repository.ts**: on insert failure it throws an `Error` with an attached `statusCode` property (a transport-specific concern), violating the forbidden pattern "or throwing transport-specific errors" — status-code mapping belongs in the inbound HTTP adapter, not the persistence layer.

4. **server/src/modules/tags/index.ts**: every export is `export * from ...` (four barrel re-exports of ports, use-cases, persistence, and HTTP routes), which the skill forbids both generally ("barrel exports that hide dependency direction") and specifically in the checklist row for `index.ts` ("must never include `export * from ...`").
