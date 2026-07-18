#!/usr/bin/env bash
set -u

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "ERROR: not inside a Git repository"
  exit 2
}
cd "$repo_root" || exit 2

source_doc="docs/BLACKSPIRE_SOURCE_OF_TRUTH.md"
branch=$(git branch --show-current)
head_commit=$(git rev-parse HEAD)
origin_main=$(git rev-parse --verify origin/main 2>/dev/null || true)
dirty=$(git status --porcelain=v1)

echo "repository root: $repo_root"
echo "branch: ${branch:-DETACHED}"
echo "HEAD: $head_commit"
echo "origin/main: ${origin_main:-UNAVAILABLE}"

if [[ -n "$origin_main" ]]; then
  counts=$(git rev-list --left-right --count "origin/main...HEAD")
  behind=${counts%%[[:space:]]*}
  ahead=${counts##*[[:space:]]}
  echo "ahead/behind origin/main: ahead=$ahead behind=$behind"
else
  echo "ahead/behind origin/main: UNAVAILABLE"
fi

if [[ -n "$dirty" ]]; then
  echo "working tree: DIRTY"
else
  echo "working tree: CLEAN"
fi

last_verified="UNAVAILABLE"
if [[ -f "$source_doc" ]]; then
  last_verified=$(sed -n 's/^- Last verified implementation commit: `\([^`]*\)`.*/\1/p' "$source_doc" | head -1)
  [[ -n "$last_verified" ]] || last_verified="UNAVAILABLE"
fi
echo "last verified commit recorded: $last_verified"

recorded_base=$(sed -n 's/^- Base `origin\/main`: `\([^`]*\)`.*/\1/p' "$source_doc" 2>/dev/null | head -1)
stale="YES"
if [[ "$last_verified" != "UNAVAILABLE" ]] && git cat-file -e "$last_verified^{commit}" 2>/dev/null \
  && [[ -n "$recorded_base" ]] && [[ "$recorded_base" == "$origin_main" ]]; then
  stale="NO"
fi
echo "canonical memory appears stale: $stale"

protected_regex='(^|/)(\.env($|\.)|id_rsa$|id_ed25519$|credentials?($|\.)|secrets?($|\.))'
protected_tracked=$(git ls-files | grep -E "$protected_regex" | grep -Ev '\.example$' || true)
if [[ -n "$protected_tracked" ]]; then
  echo "protected credential paths tracked: YES"
  printf '%s\n' "$protected_tracked" | sed 's/^/  path: /'
else
  echo "protected credential paths tracked: NO"
fi

memory_files=(docs/BLACKSPIRE_SOURCE_OF_TRUTH.md docs/BLACKSPIRE_ACTIVE_CONTEXT.md docs/BLACKSPIRE_NEXT_ACTIONS.md docs/BLACKSPIRE_DECISIONS.md docs/BLACKSPIRE_SESSION_LOG.md docs/BLACKSPIRE_MEMORY_MAINTENANCE.md)
secret_pattern='(-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|[0-9]{8,10}:[A-Za-z0-9_-]{30,})'
secret_hits=$(grep -En "$secret_pattern" "${memory_files[@]}" 2>/dev/null || true)
if [[ -n "$secret_hits" ]]; then
  echo "obvious secret-shaped content in canonical memory: YES"
  exit 1
else
  echo "obvious secret-shaped content in canonical memory: NO"
fi

if [[ "$stale" == "YES" ]] || [[ -n "$protected_tracked" ]]; then
  exit 1
fi
exit 0
