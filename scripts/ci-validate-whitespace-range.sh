#!/usr/bin/env bash
set -euo pipefail

event_name=${BLACKSPIRE_CI_EVENT_NAME:?BLACKSPIRE_CI_EVENT_NAME is required}
zero_sha=0000000000000000000000000000000000000000

require_commit() {
  local sha=$1 label=$2
  [[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "$label must be a full lowercase commit SHA" >&2; exit 1; }
  git cat-file -e "${sha}^{commit}" 2>/dev/null || { echo "$label commit is unavailable: $sha" >&2; exit 1; }
}

case "$event_name" in
  pull_request)
    base=${BLACKSPIRE_CI_BASE_SHA:?BLACKSPIRE_CI_BASE_SHA is required for pull_request}
    require_commit "$base" base
    git merge-base --is-ancestor "$base" HEAD || { echo "trusted PR base is not an ancestor of HEAD" >&2; exit 1; }
    git diff --check "$base..HEAD"
    ;;
  push)
    before=${BLACKSPIRE_CI_BEFORE_SHA:?BLACKSPIRE_CI_BEFORE_SHA is required for push}
    if [[ $before == "$zero_sha" ]]; then
      empty_tree=$(git hash-object -t tree /dev/null)
      git diff --check "$empty_tree..HEAD"
    else
      require_commit "$before" before
      git merge-base --is-ancestor "$before" HEAD || { echo "trusted push boundary is not an ancestor of HEAD" >&2; exit 1; }
      git diff --check "$before..HEAD"
    fi
    ;;
  *) echo "unsupported CI event: $event_name" >&2; exit 1 ;;
esac
