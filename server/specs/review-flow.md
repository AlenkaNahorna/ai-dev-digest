# Review flow contract

`POST /pulls/:id/review` creates one `agent_runs` row per selected agent and
persists each completed review with grounded findings linked by `run_id`.
`GET /pulls/:id/reviews` returns every review newest-first, including historical
runs for the detail page. The pull-list endpoint reports the sum of successful
run costs and computes `{critical, warning, suggestion}` from only the newest
review for each agent; the score remains from the newest review overall. A
never-reviewed PR uses `null`, while a reviewed PR with no findings uses zeroes.

Finding counts are derived from persisted findings with a SQL `COUNT` grouped
by review and severity. Opening the list or switching a UI filter never calls
an LLM. Accept and dismiss mutate one finding record and do not rewrite review
history.

Accept and dismiss mutate a finding record. Trace responses expose per-run
stats, including cost and finding count, and the trace drawer renders the
persisted findings without another model call.
