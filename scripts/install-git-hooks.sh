#!/usr/bin/env bash
set -e

cd "$(git rev-parse --show-toplevel)"

if [ -d .githooks ]; then
  chmod +x .githooks/* 2>/dev/null || true
  git config core.hooksPath .githooks
  echo "Git hooks installed from .githooks"
else
  echo ".githooks directory not found; skipping hook install."
fi
