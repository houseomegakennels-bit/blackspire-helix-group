#!/usr/bin/env bash
set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
memory_file="$repository_root/docs/BLACKSPIRE_SOURCE_OF_TRUTH.md"
agent_file="$repository_root/AGENTS.md"

if [[ ! -f "$memory_file" ]]; then
  echo "source-of-truth: missing"
  exit 1
fi

branch="$(git branch --show-current)"
head_commit="$(git rev-parse HEAD)"
verified_commit="$(sed -n 's/^- \*\*Last verified commit:\*\* `\([0-9a-f]\{7,40\}\)`.*/\1/p' "$memory_file" | head -n 1)"

echo "branch: $branch"
echo "HEAD: $head_commit"
echo "git status:"
git status --short --branch
echo "source-of-truth last verified commit: ${verified_commit:-not found}"

stale="yes"
stale_reason="last verified commit is missing or invalid"
if [[ -n "$verified_commit" ]] && git cat-file -e "${verified_commit}^{commit}" 2>/dev/null; then
  if [[ "$head_commit" == "$(git rev-parse "$verified_commit")" ]]; then
    stale="no"
    stale_reason="HEAD matches the verified implementation commit"
  elif git merge-base --is-ancestor "$verified_commit" HEAD; then
    changed_since="$(git diff --name-only "$verified_commit"..HEAD)"
    non_memory_changes="$(printf '%s\n' "$changed_since" | grep -Ev '^(AGENTS\.md|docs/BLACKSPIRE_SOURCE_OF_TRUTH\.md|scripts/update-source-of-truth-check\.sh)$' || true)"
    if [[ -z "$non_memory_changes" ]]; then
      stale="no"
      stale_reason="only canonical-memory files changed after the verified implementation commit"
    else
      stale_reason="repository implementation changed after the recorded commit"
    fi
  else
    stale_reason="recorded commit is not an ancestor of HEAD"
  fi
fi
echo "memory may be stale: $stale ($stale_reason)"

secret_pattern='(-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|[0-9]{8,10}:AA[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})'
if grep -EIn "$secret_pattern" "$agent_file" "$memory_file" >/dev/null; then
  echo "secret-shaped content in memory files: yes"
  exit 2
fi
echo "secret-shaped content in memory files: no"
