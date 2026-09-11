# R1 prospective evidence pipeline

## Purpose
Collect R1-H1 evidence after the frozen `2026-09-12` boundary without broker access, live execution, or TradingView CSV export.

## Runtime path
1. `ensure_tradingview_browser.sh` keeps the authenticated TradingView profile available on local CDP port 9222.
2. `r1_h1_prospective_collector.pine` runs on `M6E1!`, 5-minute data and exposes `HELIX_*` telemetry in TradingView's Data Window.
3. `collect_tradingview_evidence.py` reads only those telemetry fields.
4. `evidence_ledger.py` appends at most one record per research day to a SHA-256 chained JSONL ledger and recomputes the frozen statistical gate independently.
5. `run_prospective_pipeline.py` retries capture, logs failures, and refreshes the read-only status snapshot.
6. Zola's `/workspace/helix-trade-command` reads the snapshot through a read-only API route.

## Schedule
The installed root crontab uses `CRON_TZ=America/New_York` on weekdays:
- 10:05 — ensure browser session.
- 10:15 — primary capture.
- 10:20 — separate 6E robustness check.
- 10:45 — retry primary capture in case the 10:15 attempt was early or TradingView was recovering.
- `@reboot` — restore the browser automation session.

The cron daemon is enabled and running on Blackspire. Runtime logs and observations are ignored by Git.

## Gate
The primary M6E gate remains frozen: at least 30 counted events, success rate at least 55%, and Wilson 95% lower bound above 50%. The ledger cannot authorize trading. A PASS is evidence for a future human Stage 2 approval only.

## TradingView Basic constraint
Basic supports one saved chart layout and two indicators. The single saved layout is therefore reserved for the Helix prospective collector during evidence accumulation. CSV export is not used. This avoids subscription changes and prevents the research job from depending on a paid feature.

## 6E robustness
6E is robustness-only and never contributes to the M6E gate. The currently available local 6E file ends before the prospective boundary, so the robustness job reports `STALE_DATA` until a post-boundary 6E source becomes available. It does not weaken or block the primary M6E ledger.
