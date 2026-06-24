#!/usr/bin/env bash
set -euo pipefail

PICSART_MCP_URL="https://mcp.picsart.io/v1"

configure_codex() {
  local codex_config="${HOME}/.codex/config.toml"
  local tmp_file

  mkdir -p "$(dirname "$codex_config")"
  touch "$codex_config"
  tmp_file="$(mktemp)"

  awk '
    BEGIN { skip = 0 }
    /^\[mcp_servers\.gen-ai-mcp\]$/ { skip = 1; next }
    skip && /^\[/ { skip = 0 }
    !skip { print }
  ' "$codex_config" > "$tmp_file"

  if [ -s "$tmp_file" ] && [ "$(tail -c 1 "$tmp_file" 2>/dev/null || true)" != "" ]; then
    printf '\n' >> "$tmp_file"
  fi

  cat <<EOF >> "$tmp_file"
[mcp_servers.gen-ai-mcp]
url = "$PICSART_MCP_URL"

[mcp_servers.gen-ai-mcp.env_http_headers]
X-Picsart-API-Key = "PICSART_API_KEY"
EOF

  mv "$tmp_file" "$codex_config"
  echo "Configured Codex Picsart MCP in $codex_config"
}

configure_claude() {
  local claude_dir="${HOME}/.claude"
  local claude_mcp="${claude_dir}/.mcp.json"

  mkdir -p "$claude_dir"

  if command -v node >/dev/null 2>&1; then
    node - "$claude_mcp" "$PICSART_MCP_URL" <<'EOF'
const fs = require("fs");

const filePath = process.argv[2];
const url = process.argv[3];

let config = {};
if (fs.existsSync(filePath)) {
  try {
    config = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`Failed to parse ${filePath}: ${error.message}`);
    process.exit(1);
  }
}

if (!config.mcpServers || typeof config.mcpServers !== "object") {
  config.mcpServers = {};
}

config.mcpServers.picsart = {
  type: "http",
  url,
  headers: {
    "X-Picsart-API-Key": "${PICSART_API_KEY}",
  },
};

fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`);
EOF
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$claude_mcp" "$PICSART_MCP_URL" <<'EOF'
import json
import os
import sys

file_path = sys.argv[1]
url = sys.argv[2]

config = {}
if os.path.exists(file_path):
    with open(file_path, "r", encoding="utf-8") as handle:
        config = json.load(handle)

config.setdefault("mcpServers", {})
config["mcpServers"]["picsart"] = {
    "type": "http",
    "url": url,
    "headers": {
        "X-Picsart-API-Key": "${PICSART_API_KEY}"
    }
}

with open(file_path, "w", encoding="utf-8") as handle:
    json.dump(config, handle, indent=2)
    handle.write("\n")
EOF
  else
    echo "WARNING: Could not update Claude MCP config because neither node nor python3 is available."
    return 0
  fi

  echo "Configured Claude Picsart MCP in $claude_mcp"
}

echo "Configuring Picsart MCP for local agent tools..."
configure_codex
configure_claude

if [ -z "${PICSART_API_KEY:-}" ]; then
  echo "WARNING: PICSART_API_KEY is not set."
  echo "Add it as a GitHub Codespaces secret or export it before using Picsart generations."
else
  echo "PICSART_API_KEY is present in the current environment."
fi

echo "Picsart MCP setup complete."
