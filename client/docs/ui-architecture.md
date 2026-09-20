# Client UI architecture

The client is a Next.js App Router application. Route files compose data hooks and
page-level state; interactive behavior belongs in colocated `_components` marked
`"use client"`. API data flows through TanStack Query hooks in `src/lib/hooks`,
which call the Fastify API through `src/lib/api.ts`. Vendored primitives in
`src/vendor/ui` provide the shared visual and accessibility vocabulary.

The PR detail page owns URL state for tabs and the optional page-level severity
query, while each Review run accordion owns its local severity filter. Finding
cards are the action-enabled detail surface; list-page finding previews are
read-only popovers.
