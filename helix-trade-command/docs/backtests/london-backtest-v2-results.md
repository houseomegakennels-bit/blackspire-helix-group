# London Sweep Execution Backtest V2 — Results

## Primary M6E result
Historical M6E 5-minute data from 2026-01-20 through 2026-04-15 produced 61 completed research cycles. Thirty cycles failed the fixed 85% session-coverage rule because the public micro-futures feed is sparse.

The frozen V2 model produced **4 executable trades**: 2 winners and 2 losers. Net P&L was **+$24.00** on a $50,000 starting account, profit factor **1.124**, max drawdown **$110.25 / 0.221%**, and expectancy **+0.384R per trade**. Two trades hit target and two hit stop; there were no time exits.

This is encouraging relative to V1 execution, but **n=4 is far too small to infer an edge**.

## 6E robustness result
The independent full-size 6E file covered 2026-03-08 through 2026-04-15 and produced 28 completed cycles. The same frozen V2 logic produced **3 trades**, 2 winners and 1 loser, **+$443.88**, profit factor **2.467**, and expectancy **+0.808R**.

6E is robustness-only. It does not substitute for M6E evidence, and the overlapping dates mean it is not an independent time sample.

## Trade-level pattern
The two dates that won in both M6E and 6E were 2026-03-17 and 2026-03-20. The 2026-04-13 short lost in both feeds. M6E also had a losing long on 2026-03-05. Cross-contract agreement is useful implementation evidence but does not solve the sample-size problem.

## Decision
- V2 is **not approved for demo or live execution**.
- Do not tune the 1.5x displacement threshold, 50% FVG entry, 1.5R minimum, or target cap using this sample.
- The next evidence need is a materially larger out-of-sample/prospective V2 dataset.
- Keep the existing R1 prospective collector intact; V2 can be added as a parallel research track only if its rules remain frozen.
