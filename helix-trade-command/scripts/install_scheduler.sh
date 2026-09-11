#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TAG='# HELIX_R1_PROSPECTIVE'
TMP=$(mktemp)
(crontab -l 2>/dev/null || true) | grep -v "$TAG" > "$TMP"
cat >> "$TMP" <<EOF
CRON_TZ=America/New_York
5 10 * * 1-5 cd $ROOT && helix-trade-command/scripts/ensure_tradingview_browser.sh >> helix-trade-command/evidence/cron.log 2>&1 $TAG
15 10 * * 1-5 cd $ROOT && /usr/bin/python3 helix-trade-command/scripts/run_prospective_pipeline.py >> helix-trade-command/evidence/cron.log 2>&1 $TAG
20 10 * * 1-5 cd $ROOT && /usr/bin/python3 helix-trade-command/scripts/run_6e_robustness.py >> helix-trade-command/evidence/cron.log 2>&1 $TAG
45 10 * * 1-5 cd $ROOT && /usr/bin/python3 helix-trade-command/scripts/run_prospective_pipeline.py >> helix-trade-command/evidence/cron.log 2>&1 $TAG
@reboot cd $ROOT && helix-trade-command/scripts/ensure_tradingview_browser.sh >> helix-trade-command/evidence/cron.log 2>&1 $TAG
EOF
crontab "$TMP"; rm -f "$TMP"
crontab -l | grep -E 'HELIX_R1_PROSPECTIVE|CRON_TZ=America/New_York'
