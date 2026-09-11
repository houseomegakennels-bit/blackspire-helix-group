# Stage 1B — TradingView Results

## Verification status
BLOCKED AT AUTHENTICATION — compile/runtime still UNVERIFIED.

## Chart identity
- Symbol: M6E1!
- Timeframe: 5 minutes
- TradingView chart reached successfully in automated browser.
- Market data state observed: chart available, delayed market data banner shown.
- Date range loaded: NOT YET VERIFIED.
- TradingView account/plan constraints: custom Pine execution requires authenticated TradingView access in this browser session.

## Browser preflight evidence
- Automated browser opened TradingView chart successfully.
- Symbol changed from AAPL to M6E1!.
- Interval changed from 1 day to 5 minutes.
- Pine editor opened successfully.
- Attempting to use the custom Pine workflow triggered the TradingView sign-up/sign-in gate.
- Google sign-in flow was opened and is waiting for account authentication.
- No password, 2FA code, or other private authentication secret was requested, stored, or supplied by the automation.

## Compile result
- Compiler status: NOT EXECUTED.
- Compiler message(s): none attributable to the Helix validator. An initial editor insertion attempt was discarded as invalid test evidence because TradingView's Monaco editor appended content instead of replacing the starter script.

## Runtime result
- Runtime status: NOT EXECUTED.
- Runtime message(s): none.

## Observed table values
- Raw days: PENDING AUTHENTICATED RUN
- Valid days: PENDING AUTHENTICATED RUN
- Excluded days: PENDING AUTHENTICATED RUN
- Ambiguous days: PENDING AUTHENTICATED RUN
- Scenario A: PENDING AUTHENTICATED RUN
- Scenario B: PENDING AUTHENTICATED RUN
- Q4 distribution: PENDING AUTHENTICATED RUN
- Q5 distribution: PENDING AUTHENTICATED RUN
- Asia-range quartile results: PENDING AUTHENTICATED RUN

## Evidence integrity note
No compiler or strategy-statistics claim is made from the unauthenticated session. The observed M6E1!/5-minute chart setup is valid preflight evidence only.

## Gate decision
BLOCKED pending authenticated TradingView access, followed by actual validator compilation/runtime evidence. Do not advance to Stage 1C until that evidence is captured.
