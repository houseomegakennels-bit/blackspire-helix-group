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
ls -la AGENTS.md PROJECT_CONTEXT.md

echo ""
echo "📖 Agent rule: read AGENTS.md and PROJECT_CONTEXT.md before editing."
echo "✅ Agent session ready."
