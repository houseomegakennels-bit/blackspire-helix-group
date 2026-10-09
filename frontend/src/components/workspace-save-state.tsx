"use client";

import { useRef, useState } from "react";

/** Compare the current form with the exact snapshot accepted by its last save. */
export function useWorkspaceSaveState(values: unknown) {
  const current = JSON.stringify(values);
  const [saved, setSaved] = useState(current);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const inFlight = useRef(false);

  function begin() {
    if (inFlight.current) return null;
    inFlight.current = true;
    setPending(true);
    setFailed(false);
    return current;
  }

  function succeed(submitted: string) {
    setSaved(submitted);
    setSavedAt(new Date());
    setFailed(false);
    setPending(false);
    inFlight.current = false;
  }

  function fail() {
    setFailed(true);
    setPending(false);
    inFlight.current = false;
  }

  return { dirty: current !== saved, pending, failed, savedAt, begin, succeed, fail };
}

export function WorkspaceSaveState({ state, label }: {
  state: ReturnType<typeof useWorkspaceSaveState>;
  label: string;
}) {
  const message = state.pending ? "Saving…"
    : state.failed ? "Save failed. Your entries are still here; try again."
      : state.dirty ? "Unsaved changes"
        : state.savedAt ? "Saved" : "No unsaved changes";
  return (
    <div role="status" aria-live="polite" aria-atomic="true"
      className="workspace-save-state" data-state={state.failed ? "error" : state.dirty ? "unsaved" : "saved"}>
      <span>{label}: {message}</span>
      {state.savedAt ? <span className="text-[var(--copy-soft)]">Last saved in this session at <time dateTime={state.savedAt.toISOString()}>{state.savedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</time></span> : null}
    </div>
  );
}
