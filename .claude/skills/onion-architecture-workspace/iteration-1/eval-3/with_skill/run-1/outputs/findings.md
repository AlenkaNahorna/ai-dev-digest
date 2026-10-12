1. **server/src/modules/notes/domain/note-policy.ts**: The domain layer imports `simple-git` and calls it directly, but `domain/` must contain only pure business rules and must not import Node adapters or concrete SDKs.

2. **server/src/modules/notes/application/use-cases/summarize-note.ts**: The use case imports and instantiates the `openai` SDK (and reads `process.env.OPENAI_API_KEY`) directly inside `application/`, but application code may depend only on domain and ports, not on concrete provider SDKs — this LLM integration belongs behind an `application/ports/` interface implemented by an outbound adapter.

3. **server/src/modules/notes/application/use-cases/translate-note.ts**: Same violation as summarize-note.ts — it imports and instantiates the `openai` SDK directly in the application layer instead of depending on an injected port, bypassing the required inward-only dependency direction for use-cases.

4. **server/src/adapters/note-slugify.ts**: This cross-cutting adapter is only ever imported by the notes module's HTTP route (`notes.routes.ts`), violating the rule that `src/adapters/` must hold only genuinely reusable, multi-module utilities and not become a shared utility used by a single feature.

5. **server/src/modules/notes/adapters/inbound/http/notes.routes.ts**: The inbound HTTP adapter imports and directly invokes `slugifyNoteTitle` to compute transport output, pulling single-feature business/formatting logic from a non-module-local cross-cutting adapter into the route handler instead of keeping that logic module-local or exposing it through the application layer.
