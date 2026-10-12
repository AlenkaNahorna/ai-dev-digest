1. **server/src/modules/labels/domain/label-policy.ts**: The domain layer imports `labels` from the Drizzle `db/schema.js` and re-exports `labelsTableRef`/`byId` built with the `drizzle-orm` `eq` operator, coupling the innermost, framework-agnostic layer to a persistence/ORM technology it should have no knowledge of.

2. **server/src/modules/labels/adapters/inbound/http/labels.routes.ts**: The GET route bypasses the application layer entirely and queries `db.select().from(labels)...` directly inside the HTTP adapter, skipping the use case and the repository port — collapsing the architecture's layering for that endpoint.

3. **server/src/modules/labels/adapters/inbound/http/labels.routes.ts**: The POST route builds its `LabelRepositoryPort` implementation from `request.body` (`body.repository`) instead of using a composition-root-provided/injected repository, meaning the HTTP client controls which outbound adapter is used — an inversion-of-control and trust-boundary violation (arbitrary/unvalidated data from the wire is treated as a repository implementation).

4. **server/src/modules/labels/adapters/inbound/http/labels.routes.ts**: Request body and params are read via unchecked type assertions (`request.params as { repoId: string }`, `request.body as {...}`) with no schema/Zod validation, so unvalidated external input flows directly into the application and persistence layers.

5. **server/src/modules/labels/application/use-cases/create-label.ts**: The use case takes a `FastifyRequest` parameter and calls `req.log.info(...)`, pulling a framework-specific (Fastify) transport type into the application layer, which should remain independent of any specific inbound adapter technology.

6. **server/src/modules/labels/index.ts**: `registerLabelsModule` wires only the HTTP routes and never constructs/injects the `LabelRepositoryPort` (e.g. via `createLabelRepository()`) into the use case; combined with violation #3, this means there is no composition root assembling the dependency graph — the outbound adapter is never wired by the module itself.

7. **server/src/modules/labels/domain/label-policy.ts**: `normalizeLabelName` and `canAttachLabel` (pure domain policy) are defined in the same file as `labelsTableRef`/`byId` (persistence helpers), mixing a genuinely framework-free domain concern with infrastructure-specific query-building code in one module.

8. **server/src/modules/labels/adapters/outbound/persistence/label-repository.ts**: `create()` returns the raw Drizzle result row (`row`) typed only by structural assertion as `LabelRow`, with no explicit mapping from the DB row (snake_case columns per project convention) to the domain/port shape — leaking the persistence model through the port boundary instead of an explicit adapter-side mapping.
