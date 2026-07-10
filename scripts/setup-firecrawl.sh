#!/usr/bin/env bash
set -euo pipefail

# Firecrawl (firecrawl-py): turns web pages into clean markdown / structured
# data for ingestion. Unlike browser-use (which *acts* in a browser), this
# *reads* sites for scraping/crawl pipelines.
#
# IMPORTANT: the pip package installed here is only the client SDK. It does
# nothing on its own - it talks to either:
#   - Firecrawl's hosted cloud API (set FIRECRAWL_API_KEY, see
#     CODESPACES_SECRETS.md), or
#   - a self-hosted Firecrawl engine you run separately (its own Docker
#     service - not installed here).
#
# Wired into bootstrap-codespace.sh as a non-fatal step so a fresh Codespace
# has the SDK ready; standing up an actual scraping backend is a deliberate,
# separate step.

install_firecrawl() {
  if python3 -c "import firecrawl" >/dev/null 2>&1; then
    echo "firecrawl-py already installed."
  else
    echo "Installing firecrawl-py (client SDK)..."
    python3 -m pip install --user --quiet firecrawl-py || {
      echo "WARNING: firecrawl-py install failed."
      return 0
    }
  fi
}

install_firecrawl

echo "Firecrawl SDK setup complete."
if [ -z "${FIRECRAWL_API_KEY:-}" ]; then
  echo "Note: FIRECRAWL_API_KEY is not set - the SDK won't reach the hosted API"
  echo "until you set it (or point it at a self-hosted Firecrawl instance)."
fi
