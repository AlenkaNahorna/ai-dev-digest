# UI Frontend Architecture

Version: **1.0.0**  
Scope: React and Next.js App Router code architecture and organization.

This skill helps decide where frontend code belongs and how to keep a codebase
cohesive without duplicating UI, state, business rules, or data-access logic. It
does not prescribe performance optimizations or require one universal folder
tree.

## Design position

The default approach is a hybrid of route colocation and feature-oriented
vertical slices:

```text
src/
  app/                         # routing, layouts, providers, composition
  features/                    # user-value workflows
    review-pull/
      ui/ model/ api/ lib/
  entities/                    # optional stable business concepts
  shared/
    ui/ lib/ api/ config/      # business-agnostic reusable code
```

The folders are illustrative. A small project may use only `app`, route-local
code, and `shared`. Add a layer when it reduces coupling or represents a stable
ownership boundary; do not create empty layers in advance.

## Architectural rules

1. Colocate code with its only consumer. Promote it only for real reuse.
2. Organize by ownership and business meaning, not by extension or vague type
   names such as `helpers`, `misc`, or one global `components` folder.
3. Keep shared code business-neutral and make dependencies flow from shared
   primitives toward app composition.
4. Keep components focused on rendering and interaction wiring. Put domain
   rules in named model/domain functions and external I/O behind API,
   data-access, integration, or server boundaries.
5. Keep state minimal and local by default. Derive values instead of storing
   duplicates; lift state only to the closest common owner.
6. Use custom hooks for React-aware reusable behavior and plain functions for
   pure reusable logic.
7. Use reducers for complex pure state transitions; never perform I/O in them.
8. Use Effects for synchronization with external systems, not for derived data
   or to infer user events.
9. In Next.js, keep route entry points thin, prefer Server Components, and make
   Client Component boundaries narrow. Keep secrets and persistence server-only.

## File placement guide

| Code | Preferred home |
|---|---|
| Route-only UI or behavior | `app/<route>/` or a private route folder |
| Feature workflow | `features/<feature>/{ui,model,api,lib}` |
| Stable business entity | `entities/<entity>/{ui,model,api}` |
| Business-neutral primitives | `shared/ui` |
| Pure shared library code | `shared/lib` |
| Transport primitives/shared contracts | `shared/api` |
| Environment parsing/app configuration | `shared/config` or `app/config` |
| Component-only constants | Beside the component |
| Feature/domain constants | Feature/entity `config` or `model` |
| React-aware reusable behavior | Feature-local or genuinely shared hooks |
| Domain rules | Named feature/entity `model` functions |
| Persistence, secrets, SDKs | Server-only data-access/integration modules |

Avoid global `constants.ts`, `helpers.ts`, `types.ts`, or `utils/` buckets for
unrelated domains. A shared utility should be pure, stable, and
business-neutral; otherwise it belongs to the owning feature or domain.

## Dependency direction

The preferred dependency direction is:

```text
shared → entities → features → pages/routes → app composition
```

Shared code must not import feature code. Features should not import peer
features directly. Cross-feature behavior should be composed by a higher layer
or extracted into a stable lower-level contract. Public APIs should expose only
what consumers need.

Feature-Sliced Design provides an optional vocabulary and import rule for this
model. Bulletproof React provides a practical feature-based variant. Neither is
a universal template.

## Next.js-specific guidance

- `page.tsx`, `layout.tsx`, and `route.ts` are entry/composition points, not
  generic business-logic containers.
- Server Components are the default. Use Client Components for state, event
  handlers, Effects, or browser APIs; keep the boundary close to the leaf that
  needs it.
- Server Components should generally access their data source directly. Use
  Route Handlers when an HTTP boundary is required and Server Actions/Functions
  for server-side mutations with validation and authorization.
- Use route groups `(group)` and private folders `_folder` when they clarify
  ownership without affecting URLs.

## Sources used

All sources used to form this skill are listed below. Official sources are
marked where applicable; the methodology and community references are
deliberately treated as opinionated guidance rather than framework law.

### Official React

1. [Thinking in React](https://react.dev/learn/thinking-in-react) — component decomposition, minimal state, state ownership.
2. [Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure) — avoiding redundant, contradictory, and duplicated state.
3. [Managing State](https://react.dev/learn/managing-state) — lifting state, reducers, context, and scaling state management.
4. [Extracting State Logic into a Reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer) — pure reducers and complex state transitions.
5. [Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) — React-aware reuse versus plain functions.
6. [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) — derived data, event logic, and Effects as synchronization.
7. [Synchronizing with Effects](https://react.dev/learn/synchronizing-with-effects) — the boundary between rendering, events, and external systems.
8. [Built-in React Hooks](https://react.dev/reference/react/hooks) — hook semantics and the warning not to use Effects to orchestrate data flow.

### Official Next.js

9. [Project Organization and Colocation](https://nextjs.org/docs/app/building-your-application/routing/colocation) — route colocation, route groups, private folders, and the absence of one mandated structure.
10. [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) — default Server Components and narrow Client Component boundaries.
11. [Mutating Data](https://nextjs.org/docs/app/getting-started/mutating-data) — Server Functions/Actions and server-side mutations.
12. [Backend for Frontend](https://nextjs.org/docs/app/guides/backend-for-frontend) — Route Handlers, direct server-side fetching, and BFF boundaries.

### Architecture methodologies and practical references

13. [Feature-Sliced Design — Overview](https://fsd.how/docs/get-started/overview/) — layers, slices, segments, and import direction.
14. [Feature-Sliced Design — Layers](https://fsd.how/docs/reference/layers/) — layer semantics and the strict lower-layer import rule.
15. [Feature-Sliced Design — Tutorial](https://fsd.how/docs/get-started/tutorial/) — starting small, extracting shared code after real reuse, and purposeful segment names.
16. [Bulletproof React — Project Structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) — feature-based structure, shared modules, direct imports, and unidirectional flow.
17. [Bulletproof React — State Management](https://github.com/alan2207/bulletproof-react/blob/master/docs/state-management.md) — local state, reducers, and separating state categories.

### Testing boundary reference

18. [Testing Library — About Queries](https://testing-library.com/docs/queries/about/) — tests should resemble user interaction.
19. [Testing Library — React Testing Library FAQ](https://testing-library.com/docs/react-testing-library/faq/) — avoid coupling tests to implementation details.

## Versioning

- `1.0.0` — initial architecture-focused release based on the sources above.
- Update the version when rules, scope, or the source set materially changes.
- Recheck official React and Next.js documentation before a major revision.
