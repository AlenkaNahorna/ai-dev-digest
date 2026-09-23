---
name: ui-frontend-architecture
description: "Design and review React or Next.js frontend architecture: component ownership, feature boundaries, state and business logic placement, shared code, and dependency direction. Use for code organization decisions, not performance tuning."
metadata:
  version: "1.0.0"
  scope: "React and Next.js App Router architecture"
---

# UI Frontend Architecture

Use this skill when deciding where frontend code belongs, how to split a feature,
or how to review a React/Next.js structure for duplication and unclear ownership.
The goal is low duplication, high cohesion, explicit boundaries, and predictable
dependency direction. Do not optimize for a particular folder naming trend when
the codebase already has a coherent convention.

## Core rule

Start with ownership: keep code beside the route, feature, or domain that owns
the behavior. Promote code to a shared module only after there is real reuse and
the abstraction has a stable, business-neutral contract. Never use a global
`components/`, `hooks/`, `utils/`, `constants/`, or `types/` folder as a default
dumping ground for unrelated code.

## How to locate a new file

Classify the code before choosing its path:

1. Route-only composition or route-private behavior → colocate under the
   relevant `app/<route>/` segment. Next.js App Router permits safe colocation;
   only special files such as `page.tsx` and `route.ts` create route behavior.
2. A user-value workflow → keep it in a feature slice, for example
   `features/review-pull/{ui,model,api,lib}`. Create only the segments needed.
3. A stable business concept reused by multiple features → use an entity/domain
   module, for example `entities/pull/{ui,model,api}`.
4. Business-agnostic UI or infrastructure → use `shared/ui`, `shared/lib`,
   `shared/api`, or `shared/config`.
5. App wiring, providers, layouts, route composition, or server actions → use
   `app/` (or the framework's equivalent application layer).

When code has one consumer, keep it local. When it has multiple consumers,
first check whether the consumers share the same business meaning; reuse by
meaning, not merely by similar implementation.

## Component boundaries

- Route components compose data and features; they should not contain reusable
  domain policy or persistence details.
- Feature components own feature-specific interaction and presentation.
- Entity components render a stable domain concept without owning unrelated
  workflows.
- Shared UI primitives are business-agnostic and configurable through a small
  public API; they must not import features or entities.
- Split a component when it has a separate responsibility, state owner, reuse
  boundary, or test boundary—not merely because it reaches a line-count limit.
- Keep tests and styles close to the component/feature they describe unless the
  project has a strong established convention.

## Business logic, state, and hooks

- Keep pure domain rules and transformations in named `model`/domain functions;
  do not hide them in generic helpers.
- Keep complex local transitions in a pure reducer or model module. Reducers
  calculate state and never perform I/O, timers, or other side effects.
- Start state locally, lift it to the closest common owner only when needed,
  and use context for a genuinely tree-wide concern rather than default global
  state.
- Store minimal state. Derive filtered, formatted, and aggregated values during
  render; do not duplicate state and synchronize it with Effects.
- Custom hooks are for reusable React-aware behavior: state, subscriptions,
  lifecycle, or composition of other hooks. Pure functions should remain plain
  functions and must not become hooks just because they are reusable.
- Event-caused work belongs in event handlers/commands. Effects are for
  synchronization with external systems, not for orchestrating application
  data flow.

## API, configuration, constants, and utilities

- Feature API calls, DTO mapping, validation, and feature-specific request
  state stay inside the feature's `api`/`model` boundary.
- Shared API code should contain transport primitives or stable contracts, not
  feature workflows.
- Component-only constants live beside the component; feature/domain constants
  live with that feature/domain; environment parsing and app-wide config live
  in `shared/config` or `app/config` according to ownership.
- Avoid a single global `constants.ts`, `helpers.ts`, or `types.ts` for
  unrelated domains.
- A utility is shared only when it is pure, stable, and business-neutral. Name
  it by purpose (`formatPullStatus`, `parseReviewResponse`), not as a vague
  `helper`.
- Database, secrets, authentication, and external SDK access belong behind a
  server/data-access or integration boundary, never in a presentational
  component.

## Dependency direction

Prefer a one-way graph such as:

```text
shared → entities → features → pages/routes → app composition
```

The arrow means “may depend on.” Adjust the layers to the project, but enforce
these invariants:

- shared code does not import business features;
- features do not import peer features directly;
- slices on the same layer communicate through a higher composition layer or a
  deliberately shared contract;
- public entry points expose only the API needed by consumers;
- circular dependencies are a boundary problem, not an import-order problem.

Feature-Sliced Design is a useful optional vocabulary (`app`, `pages`,
`widgets`, `features`, `entities`, `shared`), not a requirement to create every
layer. Start smaller and introduce a layer only when it reduces coupling.

## Next.js App Router rules

- Treat `page.tsx`, `layout.tsx`, and `route.ts` as thin entry/composition
  points.
- Prefer Server Components by default. Add a Client Component only around the
  interactive leaf that needs state, event handlers, Effects, or browser APIs.
- Keep `use client` boundaries as narrow/deep as practical; all imports below a
  client boundary join the client module graph.
- Fetch directly from the source in a Server Component when no HTTP consumer
  needs the endpoint. Use Route Handlers for webhooks, external consumers, or a
  deliberate BFF boundary.
- Use Server Actions/Functions for server-side mutations, with validation and
  authorization at the server boundary.
- Keep server-only modules, secrets, and persistence inaccessible to client
  modules.
- Use route groups `(group)` and private folders `_folder` for organization
  when they clarify ownership without changing URLs.

## Review checklist

Before approving a structure or adding a new abstraction, ask:

- Who owns this behavior, and is the file next to that owner?
- Is this code actually reused, or is it being shared speculatively?
- Does the name communicate business purpose rather than artifact type?
- Is state minimal and owned by the closest common consumer?
- Is a custom hook truly React-aware, or should this be a pure function?
- Is business logic outside the view and I/O behind an explicit boundary?
- Can dependencies flow in one direction without peer-feature imports?
- Does a Next.js client boundary exist only where interactivity requires it?
- Would extracting this code remove duplication without creating a generic
  abstraction with many flags and unrelated callers?

Read `README.md` for the full rationale and the complete research bibliography.
