# Review contract

Every retained finding has a severity, title, category, file, and cited line
range. `groundFindings()` drops findings whose citations do not exist in the
diff, and the resulting score/verdict are derived from the surviving findings.
`run()` returns the review and cost metadata without persisting anything.
