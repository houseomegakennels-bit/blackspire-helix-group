#!/usr/bin/env bash
set -euo pipefail

# jo-inc/camofox-browser: a stealth headless browser that bypasses bot
# detection (Cloudflare, anti-scraping, etc). This is NOT called from
# bootstrap-codespace.sh and is not wired into any shared alias - run it
# yourself, deliberately, when you need it.
#
# APPROVED SCOPE: legitimate existing county/public-records data pulls that
# Seller Engine already ingests (see memory/ACTIVE_CONTEXT.md), where the
# data itself is public but the source site blocks automated access. This is
# NOT approved for general-purpose scraping of arbitrary third-party sites.

REPO_ROOT="$(git rev-parse --show-toplevel)"
TOOLS_DIR="${REPO_ROOT}/.tools"
CAMOFOX_DIR="${TOOLS_DIR}/camofox-browser"

mkdir -p "$TOOLS_DIR"

if [ -d "$CAMOFOX_DIR" ]; then
  echo "camofox-browser already cloned at $CAMOFOX_DIR"
else
  echo "Cloning jo-inc/camofox-browser..."
  git clone https://github.com/jo-inc/camofox-browser "$CAMOFOX_DIR"
fi

(
  cd "$CAMOFOX_DIR"
  echo "Installing camofox-browser dependencies..."
  npm install
)

echo ""
echo "camofox-browser is installed but NOT started."
echo "To start it (downloads the ~300MB Camoufox engine on first run):"
echo "  cd ${CAMOFOX_DIR} && npm start"
echo "It listens on port 9377. Set CAMOFOX_API_KEY before starting it in"
echo "any shared/networked environment - see its README for details."
echo ""
echo "Reminder: approved scope is existing legitimate county/public-records"
echo "data pulls only, not general-purpose scraping."
