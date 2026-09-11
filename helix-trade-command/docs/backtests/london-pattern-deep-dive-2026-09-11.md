# London Pattern Deep Dive — 2026-09-11

## Research conclusion
The strongest recurring theme across institutional-market research and current rule-based/ICT implementations is that session timing matters, but a London/Asia liquidity sweep alone is not enough directional evidence. The most defensible next execution test is a sweep-reclaim-confirm-retrace model rather than a blind fade or delayed NY entry.

## Evidence reviewed
- Federal Reserve high-frequency EBS research documents strong intraday seasonality in EUR/USD trading activity, with especially high activity during European/North American business-hour overlap and pronounced effects around macro releases: https://www.federalreserve.gov/econres/ifdp/trading-activity-and-exchange-rates-in-high-frequency-ebs-data.htm
- Federal Reserve macro-release research reports euro-dollar trading volume is particularly high around 08:00-noon New York time when Europe and North America overlap: https://www.federalreserve.gov/Pubs/ifdp/2004/823/ifdp823.htm
- OANDA analysis of >70,000 observations reports about 41% of EUR/USD daily volume occurs during the London-New York overlap: https://www.oanda.com/us-en/skills-and-insights/education/market-timing-and-volatility/when-to-trade/best-time-to-trade-forex-volume-insights/
- Academic work documents volatility spikes around the opening of major financial centers, including London and New York: https://www.sciencedirect.com/science/article/abs/pii/S1062976903000024
- eXpeed Research Lab's rule-based M5 study reports London Asia-range raids are common but displacement after a sweep is much less frequent, explicitly concluding sweeps alone are insufficient for directional conviction: https://www.expeed.co.jp/session-transition-framework/
- Contemporary ICT-style implementations consistently require a sweep followed by reclaim/rejection, MSS/CHoCH, displacement, and often an FVG retrace before entry:
  - https://www.ictkillzone.com/ict-liquidity
  - https://www.ictkillzone.com/ict-kill-zones
  - https://www.elev8-trading.com/education/session-sweeps
  - https://www.theinnercircletraders.com/ict-crt-strategy/

## What was rejected
- Blindly fading every London sweep: V1 directional evidence and execution expectancy were too weak.
- Waiting until 07:00 ET and entering at NY open: V1 produced only marginal dollar profit and negative normalized expectancy.
- Waiting for the full R1-H1 NY confirmation sequence and then entering: historical execution was 0/4 in V1 despite some directional hits, showing confirmation can arrive too late for a favorable trade location.
- Optimizing multiple parameters after seeing results: prohibited because it would turn the same small sample into an overfit search.

## V2 hypothesis
The sweep is context, not entry. A better location may occur when London itself sweeps one Asia extreme, reclaims the range, breaks internal structure with displacement, creates an FVG, and then retraces to the FVG midpoint before 05:00 ET. Stop belongs beyond the sweep extreme; the opposite Asia boundary provides the natural liquidity target, subject to minimum 1.5R and a conservative 3R cap.

The exact V2 rules were frozen in `london-backtest-v2-spec.md` before outcomes were evaluated.
