# Client Module — @devdigest/web

Next.js 15 studio UI. Import repos, browse PRs, run AI reviews, read findings, and edit agents. React Server Components + Client hooks over Fastify API via TanStack Query.

## Stack

- **Framework**: Next.js 15 (App Router)
- **UI**: React 19 (RSC + client components), TailwindCSS 4
- **Data**: TanStack Query (React Query) hooks over Fastify API
- **UI Primitives**: Vendored under `src/vendor/ui` (@devdigest/ui)
- **Shared Schemas**: Zod contracts from the canonical `../server/src/vendor/shared` source, exposed at `src/vendor/shared` via symlink (@devdigest/shared)
- **Internationalization**: `next-intl` (messages in `messages/<locale>/*.json`)
- **Viz**: `recharts` (charts), `mermaid` (diagrams), `react-markdown` (findings)

## Commands

- `pnpm dev` — Dev server `:3005` (hot reload)
- `pnpm build` — Production build (static + server routes)
- `pnpm start` — Run built app
- `pnpm test` — Component tests (vitest + jsdom; fetch mocked)
- `pnpm typecheck` — TypeScript validation
- `pnpm lint` — Client lint/static-analysis command; use `pnpm typecheck` as the enforced check until ESLint is configured.

## Configuration

- **API base**: `NEXT_PUBLIC_API_BASE` env var (default `http://localhost:3001`), used by `src/lib/api.ts`
- **.env.example** — Copy to `.env.local` for local overrides

## Key Rules

- **No barrel exports** — Import directly from source files
- **Shared contract ownership** — Never edit or recreate a client-local copy of `src/vendor/shared`; update the canonical server source.
- **React Server Components first** — Route `page.tsx` files are Server Component entrypoints; interactive behavior lives in feature screens/components with `'use client'`.
- **TanStack Query for API data** — Feature hooks live in `src/features/*/api/hooks.ts`, use `src/lib/api.ts`, and use typed key factories from `src/shared/api/query-keys.ts`. `src/lib/hooks/*` is a compatibility layer.
- **Fetch is mocked in tests** — No API or browser required for component tests
- **TailwindCSS 4** — No css-in-js; all styling via class names

## Architecture

### UI route map (src/app)

```
/ (root)
  → /repos/:repoId/pulls (PR list)
    → /repos/:repoId/pulls/:number (PR detail)
      ├─ Overview (metadata, agents)
      ├─ Diff viewer
      └─ Findings (filterable)

/agents (list) → /agents/:id (editor)
/settings/:section (Settings UI)
  ├─ API keys (OpenAI, Anthropic, etc.)
  ├─ GitHub token
  └─ Model selection
/onboarding (add repo)
```

Each page is a thin route entrypoint; feature logic sits in `src/features/<feature>/{api,model,ui}/` and colocated route components remain only for page-specific visual pieces.

### Data flow

```
React component (RSC or client)
  → useRepos() / useReviews() / etc. (src/lib/hooks/*)
    → TanStack Query (caching, refetch, polling)
      → src/lib/api.ts (fetch wrapper)
        → Fastify API (:3001)
```

### Key files

- `src/app/` — Page routes (RSC)
- `src/components/app-shell/` — Chrome (nav, breadcrumbs, shortcuts)
- `src/lib/hooks/` — Data hooks (TanStack Query)
- `src/lib/api.ts` — HTTP client (fetch base URL, headers, error handling)
- `src/vendor/ui/` — UI primitives (buttons, cards, modals, etc.)
- `src/vendor/shared/` — Zod contracts (same source as server)

## Testing

### Component tests (*.test.tsx)

Run via vitest + jsdom with fetch mocked:
```bash
pnpm test
```

No API or browser needed. Example:
```typescript
import { render, screen } from '@testing-library/react'
import { RepoList } from './RepoList'

it('renders repos', () => {
  render(<RepoList />)
  expect(screen.getByText(/repo/i)).toBeInTheDocument()
})
```

### Browser e2e tests

Real app journeys (client + API + seeded DB) are in `../e2e/` and run via `e2e-web.yml` workflow. These are deterministic and don't use LLM.

See [../TESTING.md](../TESTING.md) for full strategy.

## Related Documentation

### Read When

- Architecture/UI boundaries: [docs/ui-architecture.md](docs/ui-architecture.md)
- Route and data contracts: [specs/pages.md](specs/pages.md)

- [UI route diagram](README.md#ui-route-map) — Full page & API map
- [Component testing guide](README.md#testing) — Test patterns
- [API reference](../server/AGENTS.md) — Fastify endpoints consumed here
- [Root AGENTS.md](../AGENTS.md) — Project structure

## Session Protocol — Client Module

### 🟢 BEFORE You Start

**Read client/INSIGHTS.md** and summarize the top 3 entries relevant to your task:
- Working on pages/routes? → Check "What Works" (RSC by default)
- Working on components? → Check "What Doesn't Work" (barrel exports, `'use client'` everywhere)
- Working on data fetching? → Check "Codebase Patterns" (TanStack Query)
- Writing tests? → Check "Tool & Library Notes" (fetch mocking, userEvent)

**Example**: "I'm adding a new findings list component. Top 3 relevant insights:
1. RSC by default; only use `'use client'` for interactivity
2. TanStack Query hooks in `src/lib/hooks/`; always use for API data
3. Test with `userEvent`, not `fireEvent`"

### 🔴 END OF SESSION

Write insights **only if substantial**. Check ENGINEERING-INSIGHTS.md first for duplicates.

**Common scenarios:**

✅ **Write**: "RSC by default; only add `'use client'` if component has state/effects"
❌ **Skip**: "React is useful" (obvious)

✅ **Write**: "Mermaid rendered on server breaks DOM; wrap in useEffect or dynamic() with ssr:false"
❌ **Skip**: "Be careful with hydration" (too vague)

## Lazy-Load Context

- **Skills**: `/react-best-practices`, `/react-testing-library`, `/next-best-practices`, `/engineering-insights`
- **Module insights**: See `INSIGHTS.md` (append-only learnings from prior sessions)
- **Related modules**: See [server/AGENTS.md](../server/AGENTS.md) (API provider), [e2e/AGENTS.md](../e2e/AGENTS.md) (integration tests)
