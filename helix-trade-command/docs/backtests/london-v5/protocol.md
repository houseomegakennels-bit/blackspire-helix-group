# London V5 recovery protocol — 2026-09-12

Status: registered before this resumed session evaluates V5 outcomes. Research only; no trading or deployment authority.

## Provenance and exposure
- Resume the preserved `/tmp/v5_research.py` and `/tmp/v5_candidates.json`; preserve originals unchanged.
- Generator SHA-256: `a8372273217b6a72604d4e1220bd183f83cd8389657c0fa82b203dca843cbba1`.
- Candidate SHA-256: `62dcd485326e427dd5d557c6ee07ef78936daa69453ff8737f2d50edc7bc867b`.
- HistData 2009–2024 UTC 5-minute CSV SHA-256: `6c33f99a43c007e08d4ce66fe0e3fc17d0374e97406d35749a79165ba3bfde1d`.
- Earlier V2–V4 research already exposed 2009–2024, direct M6E Jan–Apr 2026, and the separate EUR/USD Mar–Sep 2026 sample. None is a genuinely unseen final holdout.
- Development: research days 2009-01-01 through 2018-12-31. Internal validation: 2019-01-01 through 2024-12-31. No internal outcome may influence parameters or ranking.
- No verified unseen final-holdout dataset is available in the preserved package. Its absence must not be replaced by relabeling old data.

## Frozen bounded search
- Families: ALL, NY_LONDON_SWEEP_REJECT, NY_ACCEPT_CONT.
- Price targets: 0.5, 0.75, 1.0, 1.25, 1.5, 2.0 reference R.
- Minimum stop: 5, 10, 15, 20, 30 actual M6E-sized ticks; the preserved `stop_ticks` field is in half-sized 0.00005 signal units, so divide it by two.
- Latest entry: 60, 120, 175 minutes after 07:00 New York time, inclusive.
- Direction context: ALL, WITH_LONDON, AGAINST_LONDON. Minimum displacement multiple: 1.5, 2.0, 2.5.
- Exhaustively evaluate this fixed Cartesian grid: 2,430 configurations. No weekday mining, new thresholds, or second validation-selected candidate.
- Select at most one earliest eligible trade per research day; break simultaneous ties by family name, then side. Never use an outcome to break ties.
- Among configurations with at least 100 development trades, rank by descending 95% Wilson win-rate lower bound, then base-cost mean R, then trade count, then ascending canonical parameter JSON.
- Freeze the top-ranked candidate before internal validation, even if it fails the development goal; in that case internal evaluation is diagnostic only, not advancement.
- Development goal: at least 75% net wins, positive base and stress expectancy, base USD profit factor above 1, and positive base expectancy in at least 60% of active years, with at least 100 trades.
- Run internal validation exactly once for that frozen parameter set; same goal criteria except the minimum internal sample is 50 trades. No tuning after this internal read.

## Costs and interpretation
- CME Rulebook chapter 292 specifies a 12,500 EUR unit and 0.0001 USD/EUR minimum tick worth $1.25. Source: https://www.cmegroup.com/rulebook/CME/III/250/292/292.pdf (verified 2026-09-12).
- Preserve the original signal geometry and continuous-price spot-proxy outcomes. Do not silently redesign the signal while correcting the cost arithmetic.
- Original outcomes charged $2.75 per round trip ($0.625 slippage each side plus assumed $1.50 commission).
- Base research costs are $4.00 per round trip (one actual M6E-sized tick each side plus assumed $1.50 commission); stress costs are $6.50 (two actual ticks each side plus the same commission).
- Correct each original net R by subtracting `(new_cost - 2.75) / (0.625 * preserved_stop_units)`. Dollar outcomes use one hypothetical 12,500-EUR unit, not a funded account or sizing simulation.
- The $1.50 commission is a research assumption, not a verified current broker quote. Bid/ask spreads, basis, contract rolls, exchange-price rounding, gaps, queue position and liquidity are not validated by this spot-proxy experiment.
- The preserved rejection stop freezes the sweep extreme after the first following NY bar; do not misdescribe it as an extreme continually updated until entry. Retain stop-first ambiguities and no target credit on the entry bar.
- Report base and stress results, exact counts, Wilson intervals, expectancy in R, one-unit net modeled dollars, profit factor, losing streak and year breakdowns. Do not equate spot-proxy evidence with tradable M6E execution evidence.
- HistData is bid OHLC with fixed EST source timestamps, without DST; the preserved input is already UTC and the generator uses America/New_York. Source: https://www.histdata.com/f-a-q/ (verified 2026-09-12).

## Final holdout and stopping
- Only a frozen candidate passing development and internal gates may advance to an independently verified, previously unexamined holdout with documented instrument/data provenance and an exposure ledger.
- A 75% observed holdout claim requires at least 100 trades on 100 distinct days, at least 75% net wins and positive post-cost expectancy. Report the confidence interval; do not claim the underlying or future win probability is guaranteed to be 75%.
- This preserved spot-proxy package cannot certify a genuine M6E holdout. Final holdout remains NOT RUN unless fresh eligible data and a validated direct-instrument execution model are supplied; no mock final PASS is permitted.
- If the frozen candidate fails, close this bounded research batch, retain all results, and leave any future holdout unopened. Any later development is a separately registered experiment; do not choose another candidate using the failed internal result.

## Reproducibility and scope
- Preserve source and candidate hashes, split-specific hashes, the complete grid ledger, freeze hash, code/protocol hashes, tests and exact reproduction commands.
- Verify preserved candidate generation against the pinned source CSV with a streaming adapter that preserves the original cycle semantics; do not load the full history into memory on the busy server.
- Rerunning an unchanged frozen experiment is a reproducibility check, not permission to adapt it. Changed data, code, protocol or parameters invalidate the freeze.
- Merge only reviewed, reproducible research code/evidence/documentation. Do not edit the production workspace, broker paths, live risk settings, prior V2–V4 artifacts, or the original `/tmp` files.
