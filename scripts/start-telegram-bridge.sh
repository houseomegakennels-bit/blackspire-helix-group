#!/usr/bin/env bash
set -euo pipefail

# One-shot launcher for the personal Telegram-Aider bridge, so getting it
# live is a single command instead of several. It:
#   1. installs the one dependency if missing,
#   2. checks the required secrets are present (clear message if not),
#   3. starts the bridge in the background and confirms it stayed up.
#
# This is standalone and opt-in - it is NOT called from bootstrap-codespace.sh
# or any shared alias. Run it deliberately:  bash scripts/start-telegram-bridge.sh
#
# Note: like any background process in a Codespace, this survives closing the
# terminal but NOT the Codespace idling out (auto-stop kills it).

cd "$(git rev-parse --show-toplevel)"
LOG=".telegram-bridge.log"

# 1. dependency
if ! python3 -c "import telegram" >/dev/null 2>&1; then
  echo "Installing python-telegram-bot..."
  python3 -m pip install --user --quiet python-telegram-bot
fi

# 2. secrets
missing=0
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "MISSING SECRET: TELEGRAM_BOT_TOKEN"
  missing=1
fi
if [ -z "${TELEGRAM_ALLOWED_USER_ID:-}" ]; then
  echo "MISSING SECRET: TELEGRAM_ALLOWED_USER_ID"
  missing=1
fi
if [ "$missing" = 1 ]; then
  echo ""
  echo "Add the missing secret(s) in GitHub -> Settings -> Codespaces -> Secrets,"
  echo "grant this repository access, then REBUILD the Codespace and run this again."
  exit 1
fi

# 3. don't double-start
if pgrep -f "telegram-aider-bridge.py" >/dev/null 2>&1; then
  echo "The bridge is already running (pid: $(pgrep -f telegram-aider-bridge.py | tr '\n' ' '))."
  echo "Stop it with:  pkill -f telegram-aider-bridge.py"
  exit 0
fi

echo "Starting the Telegram-Aider bridge in the background..."
nohup python3 scripts/telegram-aider-bridge.py > "$LOG" 2>&1 &
disown || true
sleep 3

if pgrep -f "telegram-aider-bridge.py" >/dev/null 2>&1; then
  echo ""
  echo "It's LIVE. Startup log:"
  tail -n 5 "$LOG"
  echo ""
  echo "Message your bot from Telegram to use it."
  echo "Stop it with:  pkill -f telegram-aider-bridge.py"
else
  echo ""
  echo "The bridge did not stay running. Last log lines:"
  tail -n 20 "$LOG"
  exit 1
fi
