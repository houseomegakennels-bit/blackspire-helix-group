#!/usr/bin/env bash
set -uo pipefail

child_pid=''
child_status=1

forward_signal() {
  local signal="$1"
  if [[ -n "$child_pid" ]] && kill -0 "$child_pid" 2>/dev/null; then
    kill -s "$signal" "$child_pid" 2>/dev/null || true
  fi
}

trap 'forward_signal HUP' HUP
trap 'forward_signal INT' INT
trap 'forward_signal TERM' TERM

"$@" &
child_pid=$!

while true; do
  reaped_pid=''
  wait -n -p reaped_pid
  wait_status=$?
  if [[ "$reaped_pid" == "$child_pid" ]]; then
    child_status=$wait_status
    break
  fi
done

# A trusted runner must not leave any process behind. PID 1 can see the whole
# namespace even when a descendant changed session, process group, and stdio.
survivor_count=0
for process_directory in /proc/[0-9]*; do
  process_id="${process_directory##*/}"
  if [[ "$process_id" != '1' ]]; then survivor_count=$((survivor_count + 1)); fi
done
if (( survivor_count > 0 )); then
  if (( child_status == 0 )); then child_status=1; fi
  kill -TERM -1 2>/dev/null || true
  /usr/bin/sleep 0.05
  kill -KILL -1 2>/dev/null || true
fi

# Reap terminated descendants adopted by namespace PID 1.
while wait -n 2>/dev/null; do :; done
exit "$child_status"
