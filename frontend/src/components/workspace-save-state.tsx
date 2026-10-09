"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const unsavedForms = new Map<object, boolean>();
function protectUnload(event: BeforeUnloadEvent) {
  if ([...unsavedForms.values()].some(Boolean)) { event.preventDefault(); event.returnValue = ""; }
}
function protectLink(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest("a") : null;
  if (!link || link.hasAttribute("download") || link.target === "_blank") return;
  const target = new URL(link.href, window.location.href);
  if (target.pathname === window.location.pathname && target.search === window.location.search) return;
  if ([...unsavedForms.values()].some(Boolean) && !window.confirm("You have unsaved changes. Leave this page and discard them?")) { event.preventDefault(); event.stopPropagation(); }
}

/** Install at the root so every same-document history entry has a position. */
export function WorkspaceHistoryGuard({ children }: { children: ReactNode }) {
  useEffect(() => {
    const indexKey = "__blackspireHistoryIndex";
    const push = window.history.pushState;
    const replace = window.history.replaceState;
    let current = Number(window.history.state?.[indexKey] ?? 0);
    let restoring = false;
    replace.call(window.history, { ...window.history.state, [indexKey]: current }, "");
    const pushTracked: History["pushState"] = function(this: History, state, unused, url) {
      const next = current + 1;
      push.call(this, { ...state, [indexKey]: next }, unused, url);
      current = next;
    };
    const replaceTracked: History["replaceState"] = function(this: History, state, unused, url) {
      replace.call(this, { ...state, [indexKey]: current }, unused, url);
    };
    window.history.pushState = pushTracked;
    window.history.replaceState = replaceTracked;
    function guardHistory(event: PopStateEvent) {
      if (restoring) { restoring = false; event.stopImmediatePropagation(); return; }
      const next = event.state?.[indexKey];
      // Entries from other documents use beforeunload, not Next's soft navigation.
      if (typeof next !== "number" || next === current) return;
      if ([...unsavedForms.values()].some(Boolean) && !window.confirm("You have unsaved changes. Leave this page and discard them?")) {
        event.stopImmediatePropagation();
        restoring = true;
        window.history.go(current - next);
        return;
      }
      current = next;
    }
    window.addEventListener("popstate", guardHistory, true);
    return () => {
      window.removeEventListener("popstate", guardHistory, true);
      if (window.history.pushState === pushTracked) window.history.pushState = push;
      if (window.history.replaceState === replaceTracked) window.history.replaceState = replace;
    };
  }, []);
  return children;
}

export function useUnsavedWorkWarning(dirty: boolean) {
  const identity = useRef({});
  useEffect(() => {
    const key = identity.current;
    unsavedForms.set(key, dirty);
    window.addEventListener("beforeunload", protectUnload);
    document.addEventListener("click", protectLink, true);
    return () => {
      unsavedForms.delete(key);
      if (!unsavedForms.size) { window.removeEventListener("beforeunload", protectUnload); document.removeEventListener("click", protectLink, true); }
    };
  }, [dirty]);
}

/** Compare the current form with the exact snapshot accepted by its last save. */
export function useWorkspaceSaveState(values: unknown) {
  const current = JSON.stringify(values);
  const [saved, setSaved] = useState(current);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const inFlight = useRef(false);
  useUnsavedWorkWarning(current !== saved || pending);

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

  function acknowledgeFields(fields: Record<string, unknown>) {
    setSaved((previous) => JSON.stringify({ ...JSON.parse(previous), ...fields }));
    setSavedAt(new Date());
    setFailed(false);
  }

  function succeedFields(fields: Record<string, unknown>) {
    acknowledgeFields(fields);
    setPending(false);
    inFlight.current = false;
  }

  function load(values: unknown) { setSaved(JSON.stringify(values)); setSavedAt(null); setFailed(false); }

  function fail() {
    setFailed(true);
    setPending(false);
    inFlight.current = false;
  }

  return { dirty: current !== saved, pending, failed, savedAt, begin, succeed, fail, load, acknowledgeFields, succeedFields };
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
