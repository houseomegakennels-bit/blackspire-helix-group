# R1-H1 — Implementation Check

## Status
**IMPLEMENTATION VERIFIED FOR RESEARCH USE; PRIMARY VALIDATION NOT STARTED.**

The preregistered R1-H1 definition is implemented in `scripts/r1_h1_validator.py`. The script is dependency-free, reads the existing CME 5-minute CSV schema, enforces the fixed session windows and 85% coverage rule, and supports a validation-start boundary so pre-registration data cannot accidentally count toward the prospective pass/fail sample.

## Historical discovery/debug run
Historical data through 2026-09-11 is explicitly discovery/debug only under the R1 preregistration. Running the frozen implementation against the available public M6E file produced:
- 62 raw days; 29 complete days.
- 21 London single-sweep candidates.
- 4 complete R1-H1 NY-confirmed events.
- 3/4 directional successes = 75.0%.
- Wilson 95% approximately [30.1%, 95.4%] — PROVISIONAL.
- 17 candidate days did not complete the NY sequence; 2 included an ambiguous NY bar.

This result is **not validation evidence** and may not be used to pass R1-H1.

## Same-underlying debug proxy
The 6E file, using the M6E tick size only to debug comparable rule behavior, produced 7 confirmed events and 5 successes (71.4%). This is also discovery/debug only and is never pooled with the M6E primary sample.

## Prospective-boundary check
Running the historical M6E file with `--validation-start 2026-09-12` returns zero complete validation days and zero events, confirming that already examined data is excluded from the prospective sample.

## Tests
- Python compile check passes.
- Four unit tests pass for the unchanged evidence gate, coverage thresholds, zero-event handling, and Wilson interval behavior.
- `git diff --check` passes.

## Next data action
Begin accumulating direct M6E 5-minute observations from 2026-09-12 forward. Do not modify R1-H1 thresholds or event definitions while that sample accumulates.
