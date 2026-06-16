#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
BASHRC="${HOME}/.bashrc"
REPO_NAME="$(basename "$REPO_ROOT")"

append_line_once() {
  local line="$1"
  local file="$2"

  touch "$file"
  if ! grep -Fqx "$line" "$file"; then
    printf '%s\n' "$line" >> "$file"
  fi
}

echo "Bootstrapping BLACKSPIRE Codespace..."
cd "$REPO_ROOT"

echo ""
echo "Installing repository dependencies..."
npm install || true
if [ -d frontend ]; then
  (
    cd frontend
    npm install || echo "WARNING: frontend npm install failed during bootstrap."
  )
fi

echo ""
echo "Installing Codex CLI..."
npm install -g @openai/codex || echo "WARNING: Codex CLI install failed during bootstrap."

echo ""
echo "Preparing workspace scripts..."
chmod +x \
  scripts/agent-start.sh \
  scripts/agent-save.sh \
  scripts/bootstrap-codespace.sh \
  scripts/check-required-env.sh \
  scripts/codex-auth-codespace.sh \
  scripts/codex-use-api-key.sh \
  scripts/install-git-hooks.sh \
  scripts/materialize-env-from-secrets.sh \
  scripts/open-codex-workspace.sh \
  scripts/sync-workspace.sh \
  scripts/env-check \
  scripts/env-sync

echo ""
echo "Installing repository git hooks..."
bash scripts/install-git-hooks.sh

echo ""
echo "Configuring shell helpers..."
append_line_once "export PATH=\"$REPO_ROOT/scripts:\$PATH\"" "$BASHRC"
append_line_once "alias agent-start=\"bash $REPO_ROOT/scripts/agent-start.sh\"" "$BASHRC"
append_line_once "alias agent-save=\"bash $REPO_ROOT/scripts/agent-save.sh\"" "$BASHRC"
append_line_once "alias bh=\"cd $REPO_ROOT\"" "$BASHRC"
append_line_once "alias env-check=\"bash $REPO_ROOT/scripts/check-required-env.sh\"" "$BASHRC"
append_line_once "alias env-sync=\"bash $REPO_ROOT/scripts/materialize-env-from-secrets.sh\"" "$BASHRC"
append_line_once "alias codex-workspace=\"bash $REPO_ROOT/scripts/open-codex-workspace.sh\"" "$BASHRC"
append_line_once "alias repo-root=\"cd $REPO_ROOT\"" "$BASHRC"

echo ""
echo "Checking Codex auth..."
bash scripts/codex-auth-codespace.sh

echo ""
echo "Materializing environment files from Codespaces secrets..."
if ! bash scripts/materialize-env-from-secrets.sh; then
  echo "WARNING: Could not materialize one or more environment files from injected secrets."
fi

echo ""
echo "Checking required environment variables..."
if ! bash scripts/check-required-env.sh; then
  echo "WARNING: Workspace is missing one or more required secrets."
fi

echo ""
echo "Codespace bootstrap complete for $REPO_NAME."
