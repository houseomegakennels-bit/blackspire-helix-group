# Stage 1B — TradingView Results

## Verification status
AUTHENTICATED RUNTIME VERIFIED; STATISTICS REMAIN PROVISIONAL.

## Chart identity
- Symbol: `M6E1!` continuous Micro EUR/USD futures, CME.
- Timeframe: 5 minutes.
- Script timezone: `America/New_York`.
- TradingView account authenticated as `lowkeycp` in the dedicated Blackspire browser profile.
- Market data banner indicates delayed data.

## Compile/runtime evidence
- The revised Pine v6 validator compiled and loaded on the chart without a correctness-affecting runtime error.
- TradingView Basic limited the loaded 5-minute sample to about 19 completed research days in this session. The earliest reachable loaded bar after a direct Go-To test was around Aug. 16, 2026; jumping earlier did not expand the Pine dataset.
- Existing GoldenArrow and RSI indicators were temporarily removed because the Basic plan allows two indicators on the chart.

## Data-quality diagnosis
The first runtime rejected 19/19 observations because exact expected bar counts were used as a completeness test. Diagnostic runs showed observed completed-session bar counts of:
- Asia: 42–48 (mean about 46.6) vs theoretical 48.
- London: 23–24 (mean about 23.9) vs theoretical 24.
- New York: 35–36 (mean about 35.9) vs theoretical 36.

This is consistent with TradingView omitting zero-volume 5-minute intervals on this thin micro-futures feed. Stage 1B therefore uses an 85% minimum coverage threshold rather than exact equality; missing sessions still fail completeness.

## Premise-bucket correction
The original validator defines Scenario B as “London did NOT sweep.” The Stage 1A revision unintentionally narrowed B to `LONDON_NO_TOUCH`, causing all observed days to fall outside A/B. Stage 1B restores the original premise while preserving the approved sweep-direction and NY-sequence improvements:
- Scenario A: exactly one qualifying London sweep; direction comes from the swept side.
- Scenario B: no qualifying London sweep, including London break days.
- Double London sweeps remain excluded as ambiguous.
- Scenario B success still requires ordered NY sweep → MSS → displacement → opposing final close.

## Current observed sample
After the above premise-preserving diagnostic logic:
- Raw days: 19.
- Valid days: 18.
- Excluded days: 1 (double/ambiguous London sweep bucket).
- Scenario A: 10 observations, 8 successes, 80.0%; Wilson 95% CI approximately [49.0%, 94.3%] — PROVISIONAL.
- Scenario B: 8 observations, 1 success, 12.5%; Wilson 95% CI approximately [2.2%, 47.1%] — PROVISIONAL.
- Scenario B sequence failures: 7.
- Q5 Asia range mean / median: 12.3 / 11 ticks.
- Q5 Asia range p75 / p90: 15 / 17 ticks.
- Scenario A by Asia-range quartile: Q1 50%, Q2 100%, Q3 100%, Q4 insufficient/NaN in this small sample.
- Scenario B by Asia-range quartile: Q1 0%, Q2 0%, Q3 0%, Q4 33.3%.

- Q4 sweep mean / median: 1.7 / 2 ticks.
- Q4 sweep p25 / p75 / p90: 1 / 2 / 3 ticks.

## Gate decision
Stage 1B compile/runtime is operational, but the strategy evidence is not sufficient for Stage 1C advancement. The master plan requires at least 30 observations before a scenario can pass; the current Basic-plan sample provides only A=10 and B=8. No live, demo-broker, or execution work is authorized from these provisional statistics.
