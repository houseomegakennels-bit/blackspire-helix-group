#!/bin/bash
set -uo pipefail

readonly TRUSTED_ORIGIN_URL='https://github.com/houseomegakennels-bit/blackspire-helix-group.git'
readonly TRUSTED_ORIGIN_FETCH_REFSPEC='+refs/heads/*:refs/remotes/origin/*'
readonly TRUSTED_MAIN_REF='refs/remotes/origin/main'
readonly GIT_BINARY='/usr/bin/git'

fail() {
  local name="$1"
  shift
  printf 'LIVING_MEMORY_ERROR: %s: %s\n' "$name" "$*" >&2
  printf 'canonical memory appears stale: YES\n'
  printf 'LIVING_MEMORY_RESULT: FAIL\n'
  exit 1
}

if [[ ! -x "$GIT_BINARY" || ! -f "$GIT_BINARY" ]]; then
  fail GIT_EXECUTABLE_UNAVAILABLE "$GIT_BINARY is not an executable regular file"
fi

# Bind the decision to the repository that physically contains this reviewed checker. The caller's
# current directory, GIT_DIR, GIT_WORK_TREE, and related environment variables are never authority.
script_path=$(/usr/bin/readlink -f -- "${BASH_SOURCE[0]}") \
  || fail REPOSITORY_BINDING_FAILED 'cannot resolve the checker path'
repo_root=$(/usr/bin/readlink -f -- "$(dirname -- "$script_path")/..") \
  || fail REPOSITORY_BINDING_FAILED 'cannot resolve the checker repository root'

# Every Git invocation uses the reviewed absolute executable, an empty environment, disabled
# replacement objects, and no system/global/user configuration. Local repository configuration is
# still read where the contract explicitly validates it below.
git_command=(
  /usr/bin/env -i
  PATH=/usr/bin:/bin
  HOME=/nonexistent
  LC_ALL=C
  GIT_CONFIG_NOSYSTEM=1
  GIT_CONFIG_GLOBAL=/dev/null
  GIT_CONFIG_SYSTEM=/dev/null
  GIT_NO_REPLACE_OBJECTS=1
  "$GIT_BINARY"
  --no-replace-objects
  -c core.useReplaceRefs=false
  -C "$repo_root"
)

git_capture() {
  local destination="$1"
  local operation="$2"
  shift 2
  local output status
  output="$("${git_command[@]}" "$@")"
  status=$?
  if (( status != 0 )); then
    fail GIT_OPERATION_FAILED "$operation exited $status"
  fi
  printf -v "$destination" '%s' "$output"
}

git_capture actual_root 'resolve repository top level' rev-parse --show-toplevel
actual_root=$(/usr/bin/readlink -f -- "$actual_root") \
  || fail REPOSITORY_BINDING_FAILED 'Git returned an unresolvable repository root'
[[ "$actual_root" == "$repo_root" ]] \
  || fail REPOSITORY_BINDING_FAILED "checker root and Git root differ"

git_capture bare 'inspect bare-repository state' rev-parse --is-bare-repository
[[ "$bare" == 'false' ]] || fail REPOSITORY_BINDING_FAILED 'bare repositories are not accepted'

git_capture git_dir 'resolve Git directory' rev-parse --absolute-git-dir
git_dir=$(/usr/bin/readlink -f -- "$git_dir") \
  || fail REPOSITORY_BINDING_FAILED 'Git directory cannot be resolved'
git_capture common_dir_raw 'resolve common Git directory' rev-parse --git-common-dir
if [[ "$common_dir_raw" = /* ]]; then
  common_dir="$common_dir_raw"
else
  common_dir="$repo_root/$common_dir_raw"
fi
common_dir=$(/usr/bin/readlink -f -- "$common_dir") \
  || fail REPOSITORY_BINDING_FAILED 'common Git directory cannot be resolved'

# Only the intended origin identity and conventional remote-tracking namespace are trusted.
git_capture origin_url 'read origin URL' config --local --no-includes --get-all remote.origin.url
# SECURITY_CHECK: trusted-origin-url
[[ "$origin_url" == "$TRUSTED_ORIGIN_URL" ]] \
  || fail UNTRUSTED_ORIGIN_URL "origin URL does not match $TRUSTED_ORIGIN_URL"

git_capture origin_fetch 'read origin fetch refspec' config --local --no-includes --get-all remote.origin.fetch
[[ "$origin_fetch" == "$TRUSTED_ORIGIN_FETCH_REFSPEC" ]] \
  || fail UNTRUSTED_ORIGIN_FETCH_REFSPEC 'origin fetch refspec is missing, duplicated, or repointed'

# Shallow, partial, replacement, grafted, and alternate-object history cannot prove containment.
git_capture shallow 'inspect shallow-repository state' rev-parse --is-shallow-repository
[[ "$shallow" == 'false' ]] || fail SHALLOW_REPOSITORY 'complete ancestry is unavailable'

set +e
partial_clone="$("${git_command[@]}" config --local --no-includes --get-regexp \
  '^(extensions\.partialClone|remote\..*\.promisor|remote\..*\.partialCloneFilter)$')"
partial_status=$?
set -e
if (( partial_status == 0 )); then
  fail PARTIAL_CLONE_PRESENT 'promisor or partial-clone configuration is not trusted'
elif (( partial_status != 1 )); then
  fail GIT_OPERATION_FAILED "inspect partial-clone configuration exited $partial_status"
fi

git_capture replacement_refs 'inspect replacement refs' for-each-ref --format='%(refname)' refs/replace/
# SECURITY_CHECK: reject-replacement-history
[[ -z "$replacement_refs" ]] || fail REPLACEMENT_HISTORY_PRESENT 'refs/replace is not permitted'

set +e
configured_grafts="$("${git_command[@]}" config --local --no-includes --get core.graftsFile)"
configured_grafts_status=$?
set -e
if (( configured_grafts_status == 0 )); then
  fail GRAFT_HISTORY_PRESENT 'core.graftsFile is not permitted'
elif (( configured_grafts_status != 1 )); then
  fail GIT_OPERATION_FAILED "inspect core.graftsFile exited $configured_grafts_status"
fi
for graft_path in "$git_dir/info/grafts" "$common_dir/info/grafts"; do
  if [[ -s "$graft_path" || -L "$graft_path" ]]; then
    fail GRAFT_HISTORY_PRESENT "$graft_path is not permitted"
  fi
done

for alternates_path in "$git_dir/objects/info/alternates" "$common_dir/objects/info/alternates"; do
  if [[ -s "$alternates_path" || -L "$alternates_path" ]]; then
    fail OBJECT_ALTERNATES_PRESENT "$alternates_path is not permitted"
  fi
done

source_doc="$repo_root/docs/BLACKSPIRE_SOURCE_OF_TRUTH.md"
[[ -f "$source_doc" && ! -L "$source_doc" ]] \
  || fail SOURCE_DOCUMENT_UNAVAILABLE 'canonical source document is missing, non-regular, or symlinked'

mapfile -t recorded_base_lines < <(
  /usr/bin/sed -n 's/^- Base `origin\/main`: `\([^`]*\)`.*/\1/p' "$source_doc"
)
mapfile -t reviewed_commit_lines < <(
  /usr/bin/sed -n 's/^- Last verified implementation commit: `\([^`]*\)`.*/\1/p' "$source_doc"
)
(( ${#recorded_base_lines[@]} == 1 )) \
  || fail INVALID_RECORDED_BASE 'exactly one Base origin/main value is required'
(( ${#reviewed_commit_lines[@]} == 1 )) \
  || fail INVALID_RECORDED_COMMIT 'exactly one last verified implementation commit is required'
recorded_base="${recorded_base_lines[0]}"
reviewed_commit="${reviewed_commit_lines[0]}"

git_capture object_format 'read repository object format' rev-parse --show-object-format
case "$object_format" in
  sha1) object_id_pattern='^[0-9a-f]{40}$' ;;
  sha256) object_id_pattern='^[0-9a-f]{64}$' ;;
  *) fail UNSUPPORTED_OBJECT_FORMAT "unsupported repository object format: $object_format" ;;
esac

# SECURITY_CHECK: canonical-object-id
[[ "$recorded_base" =~ $object_id_pattern ]] \
  || fail INVALID_RECORDED_BASE "value is not a canonical full $object_format object ID"
[[ "$reviewed_commit" =~ $object_id_pattern ]] \
  || fail INVALID_RECORDED_COMMIT "value is not a canonical full $object_format object ID"

set +e
trusted_main_commit="$("${git_command[@]}" show-ref --verify --hash "$TRUSTED_MAIN_REF")"
trusted_main_status=$?
set -e
if (( trusted_main_status == 1 || trusted_main_status == 128 )); then
  fail TRUSTED_MAIN_REF_MISSING "$TRUSTED_MAIN_REF is unavailable"
elif (( trusted_main_status != 0 )); then
  fail GIT_OPERATION_FAILED "resolve $TRUSTED_MAIN_REF exited $trusted_main_status"
fi
# SECURITY_CHECK: trusted-main-equality
[[ "$trusted_main_commit" == "$recorded_base" ]] \
  || fail TRUSTED_MAIN_MISMATCH 'recorded Base origin/main does not equal the trusted remote-tracking ref'

verify_commit_object() {
  local object_id="$1"
  local missing_name="$2"
  local type operation status
  set +e
  type="$("${git_command[@]}" cat-file -t "$object_id")"
  status=$?
  set -e
  if (( status != 0 )); then
    fail "$missing_name" "$object_id is unavailable in the intended repository"
  fi
  [[ "$type" == 'commit' ]] || fail INVALID_COMMIT_OBJECT "$object_id resolves to $type, not a commit"
  operation="peel commit object $object_id"
  git_capture type "$operation" cat-file -e "${object_id}^{commit}"
}

verify_commit_object "$reviewed_commit" RECORDED_COMMIT_MISSING
verify_commit_object "$trusted_main_commit" TRUSTED_MAIN_COMMIT_MISSING

# Prove the reachable object graph is connected. This is additional defense after the explicit
# shallow/partial/alternate checks and turns missing parent objects into a named Git failure.
set +e
"${git_command[@]}" fsck --connectivity-only --strict --no-dangling \
  "$reviewed_commit" "$trusted_main_commit"
connectivity_status=$?
set -e
(( connectivity_status == 0 )) \
  || fail GIT_OPERATION_FAILED "history connectivity verification exited $connectivity_status"

# SECURITY_CHECK: exact-ancestry-direction
set +e
"${git_command[@]}" merge-base --is-ancestor "$reviewed_commit" "$trusted_main_commit"
ancestry_status=$?
set -e
if (( ancestry_status == 1 )); then
  fail REVIEWED_COMMIT_NOT_ANCESTOR \
    'the recorded reviewed commit is not an ancestor of trusted origin/main'
elif (( ancestry_status != 0 )); then
  fail GIT_OPERATION_FAILED "ancestry verification exited $ancestry_status"
fi

git_capture branch 'read branch name' branch --show-current
git_capture head_commit 'read HEAD' rev-parse --verify HEAD
git_capture dirty 'read working-tree status' status --porcelain=v1

printf 'repository root: %s\n' "$repo_root"
printf 'branch: %s\n' "${branch:-DETACHED}"
printf 'HEAD: %s\n' "$head_commit"
printf 'trusted origin/main: %s\n' "$trusted_main_commit"
printf 'recorded reviewed ancestor: %s\n' "$reviewed_commit"
if [[ -n "$dirty" ]]; then
  printf 'working tree: DIRTY\n'
else
  printf 'working tree: CLEAN\n'
fi

protected_regex='(^|/)(\.env($|\.)|id_rsa$|id_ed25519$|credentials?($|\.)|secrets?($|\.))'
git_capture tracked_paths 'inventory tracked paths' ls-files
protected_tracked=''
while IFS= read -r tracked_path; do
  if [[ "$tracked_path" =~ $protected_regex && ! "$tracked_path" =~ \.example$ ]]; then
    protected_tracked+="${tracked_path}"$'\n'
  fi
done <<< "$tracked_paths"
if [[ -n "$protected_tracked" ]]; then
  printf 'protected credential paths tracked: YES\n'
  printf '%s' "$protected_tracked" | /usr/bin/sed 's/^/  path: /'
  fail PROTECTED_CREDENTIAL_PATH_TRACKED 'one or more protected credential paths are tracked'
fi
printf 'protected credential paths tracked: NO\n'

memory_files=()
for memory_name in \
  BLACKSPIRE_SOURCE_OF_TRUTH.md \
  BLACKSPIRE_ACTIVE_CONTEXT.md \
  BLACKSPIRE_NEXT_ACTIONS.md \
  BLACKSPIRE_DECISIONS.md \
  BLACKSPIRE_SESSION_LOG.md \
  BLACKSPIRE_MEMORY_MAINTENANCE.md
do
  memory_path="$repo_root/docs/$memory_name"
  [[ -f "$memory_path" && ! -L "$memory_path" ]] \
    || fail SOURCE_DOCUMENT_UNAVAILABLE "$memory_name is missing, non-regular, or symlinked"
  memory_files+=("$memory_path")
done
secret_pattern='(-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|[0-9]{8,10}:[A-Za-z0-9_-]{30,})'
set +e
secret_hits=$(/usr/bin/grep -En "$secret_pattern" "${memory_files[@]}")
secret_status=$?
set -e
if (( secret_status == 0 )); then
  printf 'obvious secret-shaped content in canonical memory: YES\n'
  fail SECRET_SHAPED_MEMORY_CONTENT 'canonical memory contains a protected pattern'
elif (( secret_status != 1 )); then
  fail MEMORY_SCAN_FAILED "canonical memory grep exited $secret_status"
fi
printf 'obvious secret-shaped content in canonical memory: NO\n'
printf 'canonical memory appears stale: NO\n'
printf 'LIVING_MEMORY_RESULT: PASS\n'
exit 0
