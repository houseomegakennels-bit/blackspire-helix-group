# Research Redesign R1 — Confirmed NY Reversal After London Sweep

## Status
**PREREGISTERED; NOT YET TESTED.**

This is a new research premise created after the original Scenario A/B premise failed Stage 1C. It must not inherit evidence from the rejected premise.

## Why this redesign
The rejected premise tried to predict the NY outcome directly from London behavior. R1 requires New York confirmation before making a directional claim. The goal is to trade less often but demand a clearer causal sequence.

## Target instrument and chart
- Primary: CME `M6E` / `M6E1!`.
- Research timeframe: 5 minutes.
- Session timezone: `America/New_York`.
- 6E may be used only as a robustness proxy and is never pooled into the primary pass/fail sample.

## Fixed sessions
- Asia: 20:00–00:00 ET.
- London research window: 03:00–05:00 ET.
- New York research window: 07:00–10:00 ET.
- Keep the existing 85% minimum bar-coverage rule for every required session.

## R1-H1 event definition
A candidate day exists only when London produces **exactly one qualifying sweep** of the completed Asia range and does not sweep the opposite Asia extreme. Double sweeps are excluded.

During New York, require this ordered sequence on the **same Asia extreme London swept**:
1. New York trades through that Asia extreme and closes back inside the Asia range.
2. A 3-bar swing market-structure shift forms in the reversal direction.
3. A displacement candle in the reversal direction has body size at least 1.5× the median body of the prior 20 five-minute bars.

The event is counted only after all three steps occur in order during 07:00–10:00 ET. Days without the full sequence are **no-event**, not losses.

## Directional outcome
- If the swept side is the Asia high, prediction = bearish.
- If the swept side is the Asia low, prediction = bullish.
- Success = the 10:00 ET New York-window final close is on the predicted side of the New York session open.

## Exclusions
- Missing or <85% covered required session.
- Both Asia extremes swept during London.
- A single five-minute NY bar sweeps both Asia extremes.
- The ordered NY confirmation sequence does not complete; this is a no-event and is reported separately.
- No discretionary exclusions.

## Primary gate
Use the same fixed directional evidence gate as Stage 1:
- at least 30 counted R1-H1 events;
- point estimate at least 55%;
- lower Wilson 95% confidence bound above 50%.

If any criterion fails once `n >= 30`, R1-H1 fails. The threshold will not be changed after observing results.

## Data split
Historical data already examined through **2026-09-11** is discovery-only and may be used to debug implementation, but it cannot be the sole pass sample for this new premise.

Primary validation must use data not examined when this document was written. Preferred validation start: **2026-09-12**. If prospective collection is too slow, an older untouched M6E source may be added only if its provenance is recorded and the period did not influence this hypothesis.

## Required reporting
Record raw days, complete-session days, London single-sweep candidates, NY-confirmed events, exclusions by reason, successes, Wilson interval, and event frequency. Also report sensitivity at 1.25× and 2.0× displacement as secondary diagnostics only; they cannot replace the preregistered 1.5× primary rule.

## Advancement rule
R1-H1 may move to a Stage 2 strategy specification only after the primary validation sample independently passes the gate and an operator explicitly approves advancement. Until then, no broker or execution work is authorized from R1.
