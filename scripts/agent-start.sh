#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

log() {
  printf '%s\n' "$1"
}

warn() {
  printf 'WARNING: %s\n' "$1"
}

cd "$REPO_ROOT" || exit 0

STASHED_CHANGES=0
CURRENT_BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"

log "Starting BLACKSPIRE agent session..."
log "Repo: $(pwd)"

log ""
log "Checking for local uncommitted changes..."
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  log "Local changes detected before sync:"
  git status --short || true
  log ""
  log "Stashing local changes before sync..."
  if git stash push -u -m "auto-stash-before-agent-start-$(date +%Y%m%d-%H%M%S)" >/dev/null 2>&1; then
    STASHED_CHANGES=1
  else
    warn "Could not stash local changes. Skipping auto-sync."
  fi
fi

log ""
log "Refreshing from GitHub..."
if git remote get-url origin >/dev/null 2>&1; then
  if ! git fetch origin --prune >/dev/null 2>&1; then
    warn "git fetch failed. You can still work locally in this Codespace."
  elif [ -z "$CURRENT_BRANCH" ]; then
    warn "Detached HEAD detected. Skipping automatic pull."
  elif git show-ref --verify --quiet "refs/remotes/origin/$CURRENT_BRANCH"; then
    if ! git pull --rebase origin "$CURRENT_BRANCH"; then
      warn "Auto-pull failed on branch '$CURRENT_BRANCH'. Resolve manually with git status."
    fi
  else
    warn "No matching remote branch found for '$CURRENT_BRANCH'. Skipping automatic pull."
  fi
else
  warn "No origin remote configured. Skipping automatic pull."
fi

if [ "$STASHED_CHANGES" = "1" ]; then
  log ""
  log "Restoring local changes after sync..."
  if ! git stash pop >/dev/null 2>&1; then
    warn "Could not re-apply stashed changes cleanly. Run git stash list and git stash pop manually."
  fi
fi

log ""
log "Context files available:"
ls -la AGENTS.md PROJECT_CONTEXT.md AI_WORKSPACE_SYNC.md 2>/dev/null || warn "One or more context files are missing."

log ""
log "Workspace scripts available:"
ls -la scripts/sync-workspace.sh scripts/agent-start.sh scripts/agent-save.sh 2>/dev/null || warn "One or more workspace scripts are missing."

log ""
log "Shared memory files available:"
if [ -d memory ]; then
  ls -la memory
else
  warn "memory/ directory is missing."
fi

log ""
log "Installing repository git hooks..."
if [ -f scripts/install-git-hooks.sh ]; then
  bash scripts/install-git-hooks.sh || warn "Git hook installation failed."
else
  warn "scripts/install-git-hooks.sh is missing."
fi

log ""
log "Checking required environment variables..."
if [ -f scripts/check-required-env.sh ]; then
  if ! bash scripts/check-required-env.sh; then
    warn "Workspace is missing one or more required secrets."
  fi
else
  warn "scripts/check-required-env.sh is missing."
fi

log ""
log "Agent rule: read AGENTS.md, PROJECT_CONTEXT.md, AI_WORKSPACE_SYNC.md, and memory/ before editing."
log "Agent session ready."
exit 0
