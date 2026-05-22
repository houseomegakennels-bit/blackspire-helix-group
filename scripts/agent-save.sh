#!/usr/bin/env bash
set -e

cd "$(git rev-parse --show-toplevel)"

echo "💾 Saving BLACKSPIRE workspace..."

echo ""
echo "📊 Current git status:"
git status --short

if [ -z "$(git status --porcelain)" ]; then
  echo "✅ No changes to save."
  exit 0
fi

echo ""
echo "🧪 Running frontend production build..."
if [ -d frontend ]; then
  cd frontend
  npm run build
  cd ..
fi

echo ""
echo "📦 Committing changes..."
git add .

git commit -m "Auto-save workspace $(date +%Y-%m-%d_%H-%M-%S)"

echo ""
echo "☁️ Pushing to GitHub..."
git push origin main

echo ""
echo "✅ Workspace saved successfully."
