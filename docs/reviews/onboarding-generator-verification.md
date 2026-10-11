# Onboarding generator — verification report

Plan: `docs/plans/2026-10-11-onboarding-generator.md` (rev. 2). Spec: `specs/SPEC-2026-10-11-onboarding-generator.md` (left unchanged, status draft).
Date: 2026-10-11. Branch: `feature/L05-spec-driven-development`.

## What was actually executed

| Check | Result |
|---|---|
| `tsc --noEmit` (server) | clean |
| `tsc --noEmit` (client, incl. tests) | clean (re-run after `model/parse.ts` sync: see final report) |
| dependency-cruiser (server, 199 modules) | no violations |
| Server tests via `bun test` + real PostgreSQL 16 (local, migrations applied) and real `git` | 230 pass. 14 fail, none from this feature: 13 files need the ast-grep native binding (darwin binary in a Linux sandbox), 1 existing test (`repo-intel-symbol-clamp.it.test.ts`) is not re-runnable on a persistent DB and passes on a clean one |
| Client tests via a custom jsdom harness (real vitest could not run in the sandbox) | all new feature tests + existing `query-keys`, `smoke`, `attachments` pass |

## NOT executed (must be run in CI / locally)

- Real `vitest` runs (`pnpm test`) for server and client.
- Testcontainers / Docker integration run (`pnpm test:integration`); PG was a local server, not a container.
- `next build`.
- agent-browser e2e flows `08-onboarding-tour` and `09-onboarding-public-snapshot` (written and JSON-validated only).
- Live LLM generation; the model is covered by a fake `TourModel` only. Provider error mapping is unit-level.
- Visual comparison against the screenshots in a browser.

## AC matrix

Status: **T** = covered by an automated test that ran; **U** = unit/view test only; **E** = covered only by an e2e flow that has not run; **M** = implemented, needs manual check.

| AC | Evidence (test files in `server/test/onboarding-*`, `client/src/features/onboarding-generator/**`) | Status |
|---|---|---|
| AC-1 state endpoint | `onboarding-routes.it` (GET state), `OnboardingTourView.test` | T, E |
| AC-2 auto-generate after index | `onboarding-lifecycle.it` (scheduling on index completion), `repo-index-lock.it` | T |
| AC-3 no evidence → unavailable | `onboarding-evidence-capture`, `onboarding-routes.it`, `OnboardingTourView.test` | T |
| AC-4 bounded evidence incl. docs | `onboarding-evidence-capture`, `onboarding-domain`, `onboarding-git-revision` | T |
| AC-5 owner regenerate (202) | `onboarding-routes.it` | T |
| AC-6 pending states | `onboarding-lifecycle.it`, `OnboardingTourView.test` | T |
| AC-7 CAS publication | `onboarding-lifecycle.it` | T |
| AC-8 safe error categories + retry | `onboarding-lifecycle.it`, `OnboardingTourView.test` | T |
| AC-9 previous success retained | `onboarding-lifecycle.it` | T |
| AC-10 superseded/timed-out cannot publish | `onboarding-lifecycle.it` (fencing, lease) | T |
| AC-11 section order | `onboarding-domain`, `OnboardingTourView.test` | T |
| AC-12 diagram grounded + text alternative | `onboarding-domain`, `view.test` | T |
| AC-13 Critical paths Open links | `onboarding-domain`, `view.test`, `TourSections.test` | T |
| AC-14 ordered setup commands | `onboarding-domain`, `TourSections.test` | T |
| AC-15 Copy success/failure | `TourSections.test` | U |
| AC-16 reading path | `onboarding-domain`, `TourSections.test` | T |
| AC-17 tasks as suggestions | `onboarding-domain`, `TourSections.test` | T |
| AC-18 SHA-pinned links | `view.test` | U |
| AC-19 On this page | `TourSections.test` | U |
| AC-20 collapse/expand | `TourSections.test`, e2e 08 | U, E |
| AC-21 provenance | `onboarding-lifecycle.it`, `view.test` | T |
| AC-22 degraded sections | `onboarding-domain`, `OnboardingTourView.test` | T |
| AC-23 stale indicator | `onboarding-routes.it`, `OnboardingTourView.test` | T |
| AC-24 snapshot of displayed version | `onboarding-lifecycle.it`, `ShareDialog.test` | T |
| AC-25 anonymous read, no private requests | `PublicTourScreen.test`, e2e 09 | U, E |
| AC-26 regeneration leaves snapshot unchanged | `onboarding-lifecycle.it` | T |
| AC-27 revoke | `onboarding-routes.it`, `ShareDialog.test` | T |
| AC-28 invalid ≡ revoked | `onboarding-routes.it` | T |
| AC-29 share/revoke feedback | `ShareDialog.test` | U |
| AC-30 other-member / foreign-workspace / null-owner denial | `onboarding-routes.it`, `OnboardingTourView.test` | T |
| AC-31 public links direct to provider | `view.test`, `PublicTourScreen.test` | U |
| AC-32 GET makes zero LLM calls | `onboarding-routes.it` | T |

## Assumptions and deviations

- Owner = `repos.created_by` (no richer ownership model exists). Repos with a null creator cannot regenerate or share.
- The migration is **not applied automatically**; run `pnpm db:migrate` in `server/`.
- Share links need `PUBLIC_WEB_ORIGIN`; without it links are labelled local-only and production boot logs a warning.
- The screenshot's "12,450 files" is illustrative; the subtitle shows real provenance (commit, indexed time, model).
- The seeded demo share token is a published constant for e2e only.
