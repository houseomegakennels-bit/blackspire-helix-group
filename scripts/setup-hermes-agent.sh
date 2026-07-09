#!/usr/bin/env bash
set -euo pipefail

# Free, self-hosted coding agent: Ollama running a Hermes model, driven by
# Aider, wrapped in Headroom for context compression, with the fable-mode
# skill's operating discipline applied as Aider's always-on conventions file.
# Everything here is optional and non-fatal on failure, matching the other
# steps in bootstrap-codespace.sh - a missing model pull or a slow download
# should not break the rest of the Codespace bootstrap.

REPO_ROOT="$(git rev-parse --show-toplevel)"
HERMES_MODEL="${HERMES_MODEL:-hermes3:8b}"
OLLAMA_HOST_URL="http://127.0.0.1:11434"

install_ollama() {
  if command -v ollama >/dev/null 2>&1; then
    echo "Ollama already installed."
    return 0
  fi

  echo "Installing Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh || echo "WARNING: Ollama install failed."
}

ensure_ollama_running() {
  if curl -fsS "${OLLAMA_HOST_URL}/api/version" >/dev/null 2>&1; then
    echo "Ollama server already running."
    return 0
  fi

  echo "Starting Ollama server in the background..."
  mkdir -p "${HOME}/.ollama"
  nohup ollama serve >"${HOME}/.ollama/serve.log" 2>&1 &
  disown || true

  for _ in $(seq 1 20); do
    if curl -fsS "${OLLAMA_HOST_URL}/api/version" >/dev/null 2>&1; then
      echo "Ollama server is up."
      return 0
    fi
    sleep 1
  done

  echo "WARNING: Ollama server did not come up within 20s. Check ${HOME}/.ollama/serve.log."
  return 1
}

pull_hermes_model() {
  echo "Pulling ${HERMES_MODEL} (this can take a few minutes on first run)..."
  if ! ollama pull "${HERMES_MODEL}"; then
    echo "WARNING: Failed to pull ${HERMES_MODEL}."
    echo "If this Codespace is memory-constrained, try HERMES_MODEL=hermes3:3b instead."
    return 1
  fi
}

install_aider() {
  if command -v aider >/dev/null 2>&1; then
    echo "Aider already installed."
    return 0
  fi

  echo "Installing Aider..."
  pip3 install --user --quiet aider-chat || echo "WARNING: aider-chat install failed."
}

install_headroom() {
  if command -v headroom >/dev/null 2>&1; then
    echo "Headroom already installed."
    return 0
  fi

  echo "Installing Headroom (context compression for Aider)..."
  pip3 install --user --quiet "headroom-ai[all]" || echo "WARNING: headroom-ai install failed."
}

write_aider_config() {
  local conventions_file="${REPO_ROOT}/.aider-conventions.md"
  local config_file="${REPO_ROOT}/.aider.conf.yml"
  local skill_file="${REPO_ROOT}/.claude/skills/fable-mode/SKILL.md"

  if [ -f "$skill_file" ]; then
    # Strip the YAML frontmatter (everything between the first two "---"
    # lines) - Aider has no concept of Claude Code's skill-trigger metadata,
    # so this is used as a permanent, always-on conventions file instead.
    awk 'BEGIN{d=0} /^---$/{d++; next} d>=2{print}' "$skill_file" > "$conventions_file"
    echo "Wrote Aider conventions file from fable-mode skill: $conventions_file"
  else
    echo "WARNING: $skill_file not found; skipping Aider conventions file."
    return 0
  fi

  cat > "$config_file" <<EOF
# Local Hermes model via Ollama. Run "aider" (aliased to "headroom wrap
# aider" - see bootstrap-codespace.sh) rather than invoking this file's
# settings directly through a bare aider binary, so context compression
# is applied automatically.
model: ollama/${HERMES_MODEL}
read:
  - .aider-conventions.md
EOF
  echo "Wrote Aider config: $config_file"
}

echo "Setting up local Hermes agent (Ollama + Aider + Headroom)..."
# Each step is independent and non-fatal: a failure in one (e.g. Ollama
# install blocked or unreachable) should not skip the others, since Aider,
# Headroom, and the conventions file are each useful on their own.
install_ollama || true
ensure_ollama_running || true
pull_hermes_model || true
install_aider
install_headroom
write_aider_config

echo "Hermes agent setup complete."
echo "Start it with: aider   (aliased to 'headroom wrap aider' for context compression)"
