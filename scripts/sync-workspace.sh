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
ls -la AGENTS.md PROJECT_CONTEXT.md

echo ""
echo "🧠 Agent startup rule:"
echo "Read AGENTS.md and PROJECT_CONTEXT.md before making changes."

echo ""
echo "✅ Workspace sync complete."
