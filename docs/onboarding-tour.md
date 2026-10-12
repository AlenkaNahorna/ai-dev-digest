# Onboarding Tour (generator)

A persisted, five-part guided tour of a repository, generated from its **indexed revision** and
read by new contributors: Architecture overview, Critical paths, How to run locally, Guided reading
path and First tasks. Spec: `specs/SPEC-2026-10-11-onboarding-generator.md`; plan:
`docs/plans/2026-10-11-onboarding-generator.md`; verification: `docs/reviews/onboarding-generator-verification.md`.

## Behaviour in one page

| Concern | Behaviour |
|---|---|
| Source of truth | The repo-intel index (ranked files, import graph, symbols, repo map) plus documents read **from the indexed commit** (never the live worktree). |
| Automatic generation | After a `full`/`partial` index that has real evidence completes (index, refresh, resync). De-duplicated per index identity (`sha:indexer_version:status`); disabled with `ONBOARDING_AUTO_GENERATE=false`. Failure never fails indexing. |
| Manual (Re)generate | Owner only. `POST /repos/:id/onboarding-tour/regenerate` returns `202` and a queued request; the previous successful tour stays visible until a newer one is published. |
| Failure | A safe category (`configuration`, `evidence_unavailable`, `invalid_output`, `timeout`, `provider_failure`, `internal`) — never raw provider text, prompts or stacks. The last success is never touched. |
| Cost control | Per-repository daily cap (`ONBOARDING_DAILY_BUDGET`, default 10 requests/24h incl. manual) → `budget_reached` state / `429`. Existing repos get **no** automatic tour until their next index or an owner's Generate (avoids a cost spike). |
| Versions | Immutable `onboarding_tour_versions`; a separate `onboarding_repo_state` pointer holds the latest success. Retention keeps the newest `ONBOARDING_RETAINED_VERSIONS` (default 5) plus any version a share was created from. |
| Staleness | `stale: true` when the current usable index differs from the displayed tour's `source_sha`. |

## Ownership rule

"Owner" = `repos.created_by`. Only the owner may Regenerate, Share, list or revoke shares, and only the
user who created a share may revoke it. Legacy repos with `created_by = NULL` have **no** owner: owner
actions fail closed (`403`, `owner_unassigned`) rather than guessing the system user. Other workspace
members can read the private tour (read-only); other workspaces get `404`.

## Sharing (public snapshots)

* **Explicit.** The owner confirms what becomes public, then the link is shown **once**.
* **Immutable.** A share stores a full **copy** of the displayed version's content + provenance, so later
  regeneration, retention pruning or deleting the version never changes it.
* **Token.** 32 random bytes, base64url (43 chars). Only the SHA-256 **digest** is stored; the raw token is
  never recoverable, never logged (request URLs are redacted in server logs) and never in listings.
* **Anonymous read.** `GET /public/onboarding/:token` is the only unauthenticated endpoint. Invalid,
  malformed and revoked tokens return the same generic `404`; responses are `Cache-Control: no-store`,
  `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`; 30 requests/min per IP. The payload contains
  only repository `full_name`, tour content, provenance and `shared_at` — no ids, paths on disk or private
  metadata. Source links go straight to GitHub (pinned to the stored commit), never through DevDigest.
* **Revocation limits.** Revoking stops *future* reads. It cannot recall content already read, copied,
  cached by a browser/proxy that ignored `no-store`, or screenshotted.
* **Reachability.** Links use `PUBLIC_WEB_ORIGIN`, never the request `Host`. Unset → links are
  *local-only* (the UI says so; production logs a warning). A truly public link also needs the web app
  deployed at a reachable origin and a real production `AuthProvider` for the private API.

## Configuration (`server/.env`)

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_WEB_ORIGIN` | unset | `https://host[:port]` origin for share links (no path/query/credentials). `http://localhost[:port]` accepted outside production. Invalid values fail startup. |
| `ONBOARDING_AUTO_GENERATE` | `true` | `false` disables automatic generation after indexing. |
| `ONBOARDING_DAILY_BUDGET` | `10` | Max generation requests per repository per 24h. |
| `ONBOARDING_RETAINED_VERSIONS` | `5` | Newest versions kept per repository (plus share sources). |

**Model:** Settings → Feature Models → *Onboarding Tour* (default `openrouter/deepseek/deepseek-v4-flash`).
The provider API key must be configured (Settings → API Keys); otherwise generation fails with the safe
`configuration` category. Tokens in/out and estimated cost are stored per request.

## Manual migration

Migration `0017_onboarding_generator` is **append-only and never auto-applied**:

```bash
cd server && pnpm db:migrate        # apply to your dev DB
```

It adds `onboarding_tour_versions`, `onboarding_generation_requests`, `onboarding_repo_state` and
`onboarding_shares`. The legacy `onboarding` table is untouched (its JSON was never validated against
source provenance, so it is not treated as a successful tour). Demo data: `pnpm db:seed` adds one tour and
one fixed-token public snapshot for `acme/payments-api` (the token is a published demo constant).

## Evidence, safety and grounding

* **Per-repo lock.** `platform/repo-index-lock.ts` (Postgres session advisory lock on a reserved
  connection, bounded wait, released on error and on connection loss) serializes index mutations and
  evidence capture, so a re-index cannot change graph rows mid-capture. Git reads are pinned to the
  captured full SHA (`git cat-file blob <sha>:<path>`, streaming size caps).
* **Bounded evidence.** ≤20 documents (32 KiB each, 128 KiB total), 20 ranked files, 10 chains × 8, 100 symbols,
  30 excerpts × 4 KiB, 256 KiB serialized / 24k-token estimate. The provenance line reports what was actually
  captured; truncation is surfaced ("evidence sampled, not exhaustive").
* **Secrets.** Versioned rules exclude key blocks and secret-dense files whole and redact single lines
  (cloud/VCS/chat/LLM tokens, JWTs, auth headers, URL credentials, high-entropy `*KEY/SECRET/TOKEN/PASSWORD`
  values); real `.env*` files, keys and credential stores are never read or citable (`.env.example` contributes variable names only); model output matching the rules is dropped.
* **Prompt injection.** Repository text is wrapped as untrusted data with delimiter neutralization; instructions
  never come from documents.
* **Grounding per section.** Paths must exist at the pinned commit; setup rows cite a captured document and the
  command must be supported by it (or by `package.json` scripts / compose file); diagram edges must be
  relationships the import graph supports. A section failing validation becomes an explicit "Not available"
  with a reason while the others survive.

## API

| Route | Auth | Notes |
|---|---|---|
| `GET /repos/:id/onboarding-tour` | member | Persisted state; never calls an LLM, never enqueues. |
| `POST /repos/:id/onboarding-tour/regenerate` | owner | `202`; 3/min per user. |
| `POST /repos/:id/onboarding-tour/shares` | owner | `{ tour_id }` → `201` with the raw link (once); 10/min. |
| `GET /repos/:id/onboarding-tour/shares` | owner | Opaque metadata only. |
| `DELETE /repos/:id/onboarding-tour/shares/:shareId` | owner + creator | Revoke; 10/min. |
| `GET /public/onboarding/:token` | none | Snapshot; generic `404`. |

Errors use the standard envelope: `403` not owner / unassigned, `404` unknown repo/share (also cross-workspace),
`409` no usable index, `422` validation, `429` budget or rate limit.

## Code map

* Server: `server/src/modules/onboarding-generator/{domain,application,adapters}` (onion layers enforced by
  `pnpm architecture:check`), contract `server/src/vendor/shared/contracts/onboarding-generator.ts` (import it
  directly; not in the shared barrel), schema `server/src/db/schema/onboarding-generator.ts`.
* Client: pages `client/src/app/repos/[repoId]/onboarding` and `client/src/app/share/onboarding/[token]`
  (thin RSC), feature `client/src/features/onboarding-generator/{api,model,ui}`. The public route bypasses
  `RepoProvider` so an anonymous visit makes no private request. `/onboarding` (add repository) is unrelated.
