# Review contract

Every retained finding has a severity, title, category, file, and cited line
range. `groundFindings()` drops findings whose citations do not exist in the
diff, and the resulting score/verdict are derived from the surviving findings.
`run()` returns the review and cost metadata without persisting anything.

The contract is deterministic after the provider response: findings are merged
across requested chunks, invalid citations are removed, and the score is
recomputed from retained findings rather than trusted from model output.
Severity values are `CRITICAL`, `WARNING`, and `SUGGESTION`; an empty retained
list is valid and produces an approved, high-scoring review. Callers may use
the returned cost metadata for run-level accounting, but persist findings and
review metadata in their own storage boundary.
