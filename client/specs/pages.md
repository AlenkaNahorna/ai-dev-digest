# Client page behavior

## Pull request list

`/repos/:repoId/pulls` loads enriched `PrMeta` rows. The FINDINGS column renders
latest-review severity counts. Hovering a reviewed row's severity area mounts a
read-only popover; it fetches the newest review lazily and shows title,
category, file/line, confidence, and a short rationale. It must not expose
Accept/Dismiss actions. The badges aggregate all persisted review runs for the
PR, so a clean newest run does not hide findings from an older run. The pulls
query is invalidated after a review completes.

## Pull request detail

`/repos/:repoId/pulls/:number` displays Timeline and Review runs. Review-run
cards compute severity counts from their own findings and expose three local
toggle filters. Repeating the active filter clears it. Filtering is client-side
and never starts an LLM request.
