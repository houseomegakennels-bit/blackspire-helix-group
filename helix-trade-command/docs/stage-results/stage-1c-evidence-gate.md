# Stage 1C — Evidence Gate

## Decision
**FAIL — stop the current strategy premise. Do not advance it into Stage 2 strategy automation.**

The predefined Stage 1 gate requires, per scenario, at least 30 observations, point estimate at least 55%, and a lower Wilson 95% confidence bound above 50%. Those criteria were fixed before this expanded evidence run.

## Direct M6E evidence
Two non-overlapping direct-M6E samples are available:

| Source | Window | Scenario A | Scenario B |
| --- | --- | ---: | ---: |
| TradingView `M6E1!` 5m | ~2026-08-16 to 2026-09-11 | 8/10 = 80.0% | 1/8 = 12.5% |
| Public TopstepX/ProjectX-derived M6E 5m | 2026-01-20 to 2026-04-15 UTC | 9/21 = 42.9% | 2/8 = 25.0% |
| Combined, non-overlapping | — | **17/31 = 54.84%** | **3/16 = 18.75%** |

For Scenario A, the combined Wilson 95% interval is approximately **[37.77%, 70.84%]**. Because `n=31`, the sample-size minimum is satisfied; however, the point estimate is below 55% and the lower Wilson bound is well below 50%. Scenario A therefore **FAILS** the gate.

Scenario B remains **PROVISIONAL** at `n=16`, but its current direct-M6E point estimate is only 18.75%. It provides no basis to override the Scenario A failure or continue the premise into automation.

## Public dataset quality handling
The public M6E file contains 62 completed research cycles in the available date range. Only 29 pass the existing 85% session-coverage rule; 31 are rejected as short-session observations, one is missing required sessions, and one is excluded for a double London sweep. The 85% threshold was not weakened to increase sample size.

This dataset is stored externally; raw market data is not committed to this repository. Reproducibility is preserved with the validator source, dataset path/source metadata, and SHA-256 digest in `stage-1c-evidence-summary.json`.

## Same-underlying robustness check
Full-size CME Euro FX (`6E`) from the same public repository was evaluated as a robustness proxy, not substituted for direct M6E evidence. Using the M6E tick size for rule comparability:
- Scenario A: 11/20 = 55.0%, Wilson 95% approximately [34.21%, 74.18%].
- Scenario B: 1/7 = 14.3%, Wilson 95% approximately [2.57%, 51.31%].

The proxy does not rescue the premise: Scenario A remains statistically uncertain and Scenario B remains weak.

## Provenance
Public historical files were obtained from `axb0306/cme-futures-ohlc`, whose README states the data is downloaded from the TopstepX API / ProjectX Gateway API. The M6E 5-minute file used here is `M6E/M6E_5min_20260120_20260415.csv`; the 6E proxy file is `6E/6E_5min_20260308_20260415.csv`.

Local SHA-256 digests:
- M6E: `2063a184f4be50b0344b6ef25362e5b0718476500d5e22c3a01a8a1b7be05682`
- 6E: `8ba3c43ad23bd3ba1214c3d3b87f26e1d507550826ee6457c020d3b8fea054c1`

## Reproduction
Run:

```bash
python3 helix-trade-command/scripts/offline_premise_validator.py /path/to/M6E_5min.csv --json-out /tmp/m6e-results.json
```

The offline tool mirrors the current research sessions, 85% coverage rule, London sweep buckets, Scenario A direction test, Scenario B NY sweep → MSS → displacement sequence, quartile calculations, and Wilson gate. It does not place orders and contains no broker integration.

## Stage 1C conclusion
The current ICT premise is rejected for automation. Per `AGENTS.md`, a failed gate cannot be advanced or rationalized away. The Helix platform architecture remains valid, but strategy research must return to premise design before Stage 2.
