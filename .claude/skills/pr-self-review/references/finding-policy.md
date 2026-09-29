# Finding policy

## Severity

`critical` is blocking only when the issue is confirmed and high confidence.
Use it for:

- exploitable authentication or authorization bypass;
- secret or credential exposure;
- destructive data-loss behavior or an unsafe irreversible migration;
- a confirmed critical API/contract break for existing consumers;
- a confirmed production crash or outage path;
- a violation of an explicit repository security or data-isolation invariant.

Use `high` for a likely correctness, security, data, or architecture defect that
needs fixing before approval but is not proven to meet the critical definition.
High-confidence security boundary failures are blocking even when they do not
meet the narrower `critical` definition.
Use `medium` for meaningful maintainability or boundary problems. Use `low` for
non-blocking improvements.

Never promote a subjective preference, theoretical risk, or unverified model
hypothesis to `critical`.

## Confidence

- `high`: the changed code and data/control flow prove the issue;
- `medium`: the pattern is concerning but an input, caller, or runtime condition
  is not fully established;
- `low`: theoretical or best-practice-only concern.

Low-confidence findings are advisory. Medium-confidence findings require manual
confirmation unless repository policy explicitly says otherwise.

## Deduplication

Group findings that share the same file, nearby line range, root cause, and
remediation. Keep a list of corroborating skills on the canonical finding.
Do not emit five copies of the same missing authorization check because five
skills noticed it.

## Suppressions and baseline

Suppression records must include:

- stable fingerprint;
- owner;
- reason;
- created date;
- expiration date;
- optional issue or PR link.

Expired suppressions are findings again. A suppression must never hide a newly
changed critical issue unless the reviewer proves it is the same accepted risk.

## Status calculation

```text
if required review could not run:
  REVIEW_FAILED or PARTIAL, according to repository policy
else if high-confidence critical finding exists
   or high-confidence security finding affects auth, authorization,
      cross-workspace/data isolation, secrets, or injection:
  BLOCKED
else:
  PASS
```

Always include coverage limitations in the report, even for `PASS`.
