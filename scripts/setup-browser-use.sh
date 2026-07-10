#!/usr/bin/env bash
set -euo pipefail

# browser-use/browser-use: an LLM-driven browser-automation agent. You give it
# a goal in plain language and it drives a real browser (navigate, click, fill
# forms, read the page) the way a person would, rather than calling an API.
#
# This is wired into bootstrap-codespace.sh as a non-fatal step, so a fresh
# Codespace installs it automatically. It is heavy (large dependency tree plus
# a browser), so if a bootstrap ever needs to be lean, this is a safe step to
# drop - nothing else depends on it.
#
# browser-use needs an LLM to decide what to do. It can run off the local
# Hermes model set up by setup-hermes-agent.sh (free, self-hosted, via Ollama)
# or a paid API (OpenAI etc.) if you set the matching key. See TOOLS_AVAILABLE.md.

install_browser_use() {
  if python3 -c "import browser_use" >/dev/null 2>&1; then
    echo "browser-use already installed."
  else
    echo "Installing browser-use (this pulls a large dependency tree)..."
    python3 -m pip install --user --quiet browser-use || {
      echo "WARNING: browser-use install failed."
      return 0
    }
  fi
}

install_browser() {
  # browser-use drives Chromium through Playwright. In this managed environment
  # Chromium is pre-provisioned (PLAYWRIGHT_BROWSERS_PATH), so skip the download
  # if it's already there; on a plain Codespace, fetch it via Playwright.
  if [ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ] && [ -d "${PLAYWRIGHT_BROWSERS_PATH}" ]; then
    echo "Chromium already provisioned at ${PLAYWRIGHT_BROWSERS_PATH}; skipping download."
    return 0
  fi

  echo "Installing Chromium for Playwright..."
  python3 -m playwright install chromium || echo "WARNING: Playwright Chromium install failed."
}

install_browser_use
install_browser

echo "browser-use setup complete."
echo "It needs an LLM backend - point it at the local Hermes model (Ollama) for"
echo "a free/self-hosted setup, or set a provider API key. See TOOLS_AVAILABLE.md."
