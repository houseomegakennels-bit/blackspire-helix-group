# London V5 recovery — integrity findings, 2026-09-12

## Decision
**BLOCKED_INPUT_INTEGRITY. No new strategy conclusion. No 75% claim. No trading authorization.**

Blackspire was reachable. Recovery ran in the isolated `helix-trade-command/london-v5-integrity-research` worktree from base `726b54a89b0e871531a12d1421f58c3e47d256be`. The original V5 generator and candidate JSON were recovered and their exact SHA-256 values preserved. This is not a completed V5 backtest or a strategy rejection based on V5 performance.

The registered adapter requires chronological, unique five-minute bars before candidate generation. It stopped on the first backwards timestamp. A separate timestamp-only audit inspected all **1,184,162 bars**, found **five backwards steps** and zero five-minute-alignment failures, and reproduced its report byte-for-byte on a second full pass. No automatic sorting, deduplication, exclusion or price-data repair was applied.

## Verified input defects
| CSV line | Previous UTC timestamp | Following UTC timestamp |
| ---: | --- | --- |
| 806835 | 2019-10-28 00:55 | 2019-10-28 00:00 |
| 881239 | 2020-10-26 00:55 | 2020-10-26 00:00 |
| 956613 | 2021-11-01 00:55 | 2021-11-01 00:00 |
| 1031487 | 2022-10-31 00:55 | 2022-10-31 00:00 |
| 1096543 | 2023-10-30 00:55 | 2023-10-30 00:00 |

The source spans 2009-01-01T23:55:00Z through 2024-12-31T21:55:00Z. The cause of the timestamp reversals is **UNVERIFIED**. The audit records chronology, not which trades would be affected. Do not reinterpret this audit as proof of profitability or of the validity of the original candidate outcomes.

## Stage accounting
- Original generator and candidate archive hashes: verified against preserved originals.
- Full candidate regeneration: attempted, stopped at the ordering guard; not completed.
- Development grid: 2,430 configurations registered, **zero evaluated in this recovery batch**.
- Internal validation: **NOT RUN**; no candidate frozen from new development results.
- Final holdout: **NOT RUN**; no verified genuinely unseen direct-instrument dataset in the recovered package.
- Existing V2–V4 conclusions: unchanged; no corrected historical performance numbers are claimed.
- Source CSV and original `/tmp/v5_research.py` and `/tmp/v5_candidates.json`: unchanged.

## Research harness changes
The portable adapter retains the archived generator's signal functions unchanged; an AST-equivalence regression enforces that boundary. The new harness separates preparation, development-only search, candidate freezing and single-candidate internal validation. It rejects cross-split rows and changed freeze/data/code hashes, limits selection to one outcome-independent earliest trade per day, and refuses overwriting research artifacts. These are scaffold and synthetic-test results, not evidence that a strategy passes any return or win-rate threshold.

The original signal unit is 0.00005 USD/EUR, worth $0.625 per hypothetical 12,500-EUR unit. CME chapter 292 specifies an actual M6E minimum tick of 0.0001 USD/EUR, worth $1.25. The preregistered correction uses $4.00 base round-trip cost and $6.50 stress cost, each including an assumed, not broker-verified, $1.50 commission. The archived outcomes used $2.75. Algebraic conversion tests pass, but the correction was **not applied to historical V5 outcomes** because the earlier integrity gate failed. Spot-proxy execution still cannot establish direct M6E performance. Official sources and limitations are recorded in `protocol.md`.

All recovered historical samples were already exposed by prior versions. Merely dividing them into development and internal years cannot manufacture an unseen final holdout. The claim gate requires verified unseen provenance, a prior freeze, validated direct-instrument execution, passed earlier gates, at least 100 trades on distinct days, at least 75% net wins and positive post-cost expectancy. The helper is not an independent verifier of provenance; supplied declarations must be supported by an actual evidence ledger before future use.

## Verification performed
- Initial focused harness tests: 27 passed.
- Added chronological-input, streaming-equivalence, unchanged-signal and blocked-before-outcomes regressions: combined V5 tests **33 passed**.
- Entire existing Helix unittest discovery: **62 passed**. The legacy V3 test imports an existing module that prints old V3 outcomes; this is not new V5 validation and does not make any previously exposed data unseen.
- Portable generator and research harness compile: passed.
- Original archived signal-function AST comparison: passed.
- Full timestamp audit run twice: same nonzero failure status and byte-identical JSON report.
- Preparation against the failed audit: rejected before candidate-outcome loading; no split-output directory created.
- Repository secret scan with Node 22.23.1: passed.
- Whitespace diff check: passed.
- Canonical living-memory checker: **FAIL**, `UNREVIEWED_NON_DOCUMENTATION_CHANGE`. The unchanged main worktree fails identically; its recorded implementation anchor predates non-documentation changes already on trusted main. The anchor and checker were not weakened or fabricated to obtain a pass.

## Merge and next boundary
This work is research-only and has no production/broker/risk-setting changes. **Do not merge while the required repository memory gate remains failed.** A separate, genuine review of the existing main-history/anchor discrepancy is needed; this research audit is not authority to certify unrelated implementations.

Before any new V5 outcome evaluation, investigate the source/preprocessing provenance of the five backwards steps. Register a deterministic correction or exclusion rule based only on input integrity, preserving immutable originals and all old exposure labels. Regenerate with the strict guard still enabled and independently review the corrected data lineage before resuming the registered stages. Do not silently claim the current recovery passed its regeneration gate, and do not reuse earlier internal or holdout results for tuning.

## Reproduce this checkpoint
From the repository root, use Python 3.12 and the pinned original CSV (not committed to Git):

```bash
python3 -m unittest discover -s helix-trade-command/tests -p 'test_london_v5*.py' -v
REPRO=$(mktemp -d)
python3 helix-trade-command/backtests/audit_london_v5_input.py \
  --csv /tmp/helix-extended/EURUSD_HISTDATA_2009_2024_5m_utc.csv \
  --out "$REPRO/audit.json"
# Expected exit 2: the audit correctly reports input integrity FAIL.
cmp helix-trade-command/evidence/v5/regeneration-audit.json "$REPRO/audit.json"
# Expected exit 0: byte-identical failure evidence.
python3 helix-trade-command/backtests/london_v5_research.py prepare --out "$REPRO/splits"
# Expected nonzero: failed regeneration evidence; no split files should be created.
```

Audit JSON SHA-256: `eca70e1f9c29ec86caf3092556f4848c66f78f82e2692beaf8e948a41e86e9ae`.
`evidence/v5/recovery-validation.json` binds the executed source/test/protocol/audit hashes and records the precise blocked state. The full source CSV is intentionally not uploaded to Git.

A separate read-only Codex review was attempted with a 240-second limit. It timed out (exit 124) without a final review file. **No independent approval is claimed.** This checkpoint is suitable for a draft research pull request, not an approved merge or deployment.
