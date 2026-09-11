#!/usr/bin/env bash
set -euo pipefail
PORT=${HELIX_CDP_PORT:-9222}
PROFILE=${HELIX_TV_PROFILE:-/root/.helix-tv-profile}
DISPLAY_NUM=${HELIX_DISPLAY:-:91}
TV_URL=${HELIX_TV_URL:-'https://www.tradingview.com/chart/t9VrCKbh/?symbol=CME%3AM6E1%21'}
LOG_DIR=${HELIX_BROWSER_LOG_DIR:-/tmp/helix-tv}
mkdir -p "$LOG_DIR" "$PROFILE"
if curl -fsS "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then exit 0; fi
if ! pgrep -af "Xvfb ${DISPLAY_NUM}" >/dev/null 2>&1; then nohup Xvfb "$DISPLAY_NUM" -screen 0 1280x800x24 -nolisten tcp >"$LOG_DIR/xvfb.log" 2>&1 & sleep 1; fi
if ! pgrep -af "openbox" >/dev/null 2>&1; then DISPLAY="$DISPLAY_NUM" nohup openbox >"$LOG_DIR/openbox.log" 2>&1 & sleep 1; fi
DISPLAY="$DISPLAY_NUM" nohup google-chrome --no-sandbox --disable-dev-shm-usage --remote-debugging-address=127.0.0.1 --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" --window-size=1280,800 "$TV_URL" >"$LOG_DIR/chrome.log" 2>&1 &
for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1 && exit 0; sleep 1; done
echo "TradingView browser failed to expose CDP on ${PORT}" >&2; exit 1
