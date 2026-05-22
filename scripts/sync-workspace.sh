#!/usr/bin/env bash
set -e

echo "🔄 Syncing BLACKSPIRE workspace..."

git status --short

echo ""
echo "📡 Pulling latest changes from GitHub..."
git pull origin main

echo ""
echo "🌿 Current branch:"
git branch --show-current

echo ""
echo "📁 Important context files:"
ls -la AGENTS.md PROJECT_CONTEXT.md AI_WORKSPACE_SYNC.md

echo ""
echo "🛠 Workspace scripts:"
ls -la scripts/sync-workspace.sh scripts/agent-start.sh scripts/agent-save.sh

echo ""
echo "🧾 Shared memory files:"
if [ -d memory ]; then
  ls -la memory
else
  echo "⚠️ memory/ directory is missing."
fi

echo ""
echo "🧠 Agent startup rule:"
echo "Read AGENTS.md, PROJECT_CONTEXT.md, AI_WORKSPACE_SYNC.md, and memory/ before making changes."

echo ""
echo "✅ Workspace sync complete."
