# London V2 Prospective Plan

Validation starts 2026-09-12. The implementation is frozen from the merged V2 backtest rules: Asia 20:00-00:00 ET, London 02:00-05:00 ET, exactly one Asia-extreme sweep with reclaim, 3-bar MSS, >=1.5x displacement plus first qualifying FVG, first later 50% FVG retrace, stop one tick beyond the sweep, opposite Asia extreme target with 1.5R minimum and 3R cap, 10:00 ET time exit, adverse slippage and commission.

## Parallel tracks
- R1-H1 remains the directional premise track and keeps its original 30-event/Wilson gate.
- London V2 is an execution track and never shares or rewrites the R1 ledger.
- 6E remains robustness-only and cannot satisfy the primary M6E gate.

## Frozen V2 advancement gate
All four conditions are required after at least 30 executed M6E trades:
1. post-cost mean expectancy > +0.10R;
2. normal-approximation 95% lower confidence bound on mean R > 0;
3. profit factor >= 1.25;
4. no evidence-chain integrity failure.

Passing the gate does not enable trading. It creates a research recommendation for a separately approved demo/backtest stage. Failing the gate freezes V2; any changed rule must be preregistered as V3.
