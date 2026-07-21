#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
BLACKSPIRE_ENVIRONMENT=codespace BLACKSPIRE_STATE_OWNER=codespace-disposable BLACKSPIRE_PROVIDER_MODE="${BLACKSPIRE_PROVIDER_MODE:-manual}" bash scripts/verify-environment.sh codespace
test -f package-lock.json
test -f .node-version
test -x scripts/migrate.js || test -f scripts/migrate.js
git diff --check
for command in build lint typecheck test security:scan start:iphone-test stop:iphone-test; do
  node -e "const p=require('./package.json');if(!p.scripts['$command'])process.exit(1)"
done
printf 'BLACKSPIRE CODESPACE READY: state=disposable credentials=not-loaded port=8790-only\n'
