#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TAG='# HELIX_PROSPECTIVE'
TMP=$(mktemp)
(crontab -l 2>/dev/null || true) | grep -v '# HELIX_R1_PROSPECTIVE' | grep -v '# HELIX_PROSPECTIVE' | grep -v '^CRON_TZ=America/New_York$' > "$TMP"
cat >> "$TMP" <<EOF
CRON_TZ=America/New_York
5 10 * * 1-5 cd $ROOT && helix-trade-command/scripts/ensure_tradingview_browser.sh >> helix-trade-command/evidence/cron.log 2>&1 $TAG
15 10 * * 1-5 cd $ROOT && /usr/bin/python3 helix-trade-command/scripts/run_prospective_pipeline.py >> helix-trade-command/evidence/cron.log 2>&1 $TAG
20 10 * * 1-5 cd $ROOT && /usr/bin/python3 helix-trade-command/scripts/run_6e_robustness.py >> helix-trade-command/evidence/cron.log 2>&1 $TAG
25 10 * * 1-5 cd $ROOT && /usr/bin/python3 helix-trade-command/scripts/run_v2_prospective_pipeline.py >> helix-trade-command/evidence/v2/cron.log 2>&1 $TAG
45 10 * * 1-5 cd $ROOT && /usr/bin/python3 helix-trade-command/scripts/run_prospective_pipeline.py >> helix-trade-command/evidence/cron.log 2>&1 $TAG
55 10 * * 1-5 cd $ROOT && /usr/bin/python3 helix-trade-command/scripts/run_v2_prospective_pipeline.py >> helix-trade-command/evidence/v2/cron.log 2>&1 $TAG
@reboot cd $ROOT && helix-trade-command/scripts/ensure_tradingview_browser.sh >> helix-trade-command/evidence/cron.log 2>&1 $TAG
EOF
crontab "$TMP"; rm -f "$TMP"
crontab -l | grep -E 'HELIX_PROSPECTIVE|CRON_TZ=America/New_York'
