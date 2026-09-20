# Client insights

- [2026-09-21] **Codebase Patterns**: Review-run severity filters belong beside the run's own findings; a page-level aggregate cannot prove that a pill count matches the cards below it. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:65`.
- [2026-09-21] **Decisions**: PR-list finding previews are read-only hover surfaces, while Accept/Dismiss remains on the PR detail FindingCard. Evidence: `client/src/app/repos/[repoId]/pulls/_components/FindingsPopover/FindingsPopover.tsx:14`.
- [2026-09-21] **Recurring Errors & Fixes**: Enriched PR-list fields are cached separately from review records, so a completed review must invalidate the `pulls` query or the list keeps stale score/findings. Evidence: `client/src/lib/hooks/reviews.ts:143`.
