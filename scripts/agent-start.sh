#!/usr/bin/env bash
set -e

cd "$(git rev-parse --show-toplevel)"

echo "🚀 Starting BLACKSPIRE agent session..."
echo "📍 Repo: $(pwd)"

echo ""
echo "🔒 Checking for local uncommitted changes..."
if [ -n "$(git status --porcelain)" ]; then
  echo "⚠️ Local changes detected before sync:"
  git status --short
  echo ""
  echo "Stashing local changes before pulling..."
  git stash push -u -m "auto-stash-before-agent-start-$(date +%Y%m%d-%H%M%S)" || true
fi

echo ""
echo "📡 Pulling latest from GitHub..."
git pull origin main --rebase

echo ""
echo "🧠 Context files available:"
ls -la AGENTS.md PROJECT_CONTEXT.md AI_WORKSPACE_SYNC.md

echo ""
echo "🛠 Workspace scripts available:"
ls -la scripts/sync-workspace.sh scripts/agent-start.sh scripts/agent-save.sh

echo ""
echo "🧾 Shared memory files available:"
if [ -d memory ]; then
  ls -la memory
else
  echo "⚠️ memory/ directory is missing."
fi

echo ""
echo "📖 Agent rule: read AGENTS.md, PROJECT_CONTEXT.md, AI_WORKSPACE_SYNC.md, and memory/ before editing."
echo "✅ Agent session ready."
