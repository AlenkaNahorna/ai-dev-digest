# Review flow contract

`POST /pulls/:id/review` creates agent runs and persists each completed review
with grounded findings. `GET /pulls/:id/reviews` returns newest-first review
records. The pull-list endpoint reports the sum of stored run costs and the
sum of `{critical, warning, suggestion}` findings across all review runs; the
score remains from the newest review. A never-reviewed PR uses `null`, while a
reviewed PR with no findings uses zeroes.

Accept and dismiss mutate a finding record. Trace responses expose per-run
stats, including cost and finding count, and the trace drawer renders the
persisted findings without another model call.
