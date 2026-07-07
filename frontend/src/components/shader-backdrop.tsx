"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { Component, useSyncExternalStore } from "react";

/* If the WebGL gradient throws (context creation fails, e.g. WebGL disabled
   in enterprise/remote browsers), render nothing — the CSS aurora/watermark
   layers behind it remain the backdrop. */
class BackdropBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/* Lazy-load the WebGL canvas — only on desktop, only if motion is allowed */
const ShaderBackdropCanvas = dynamic(
  () => import("@/components/shader-backdrop-canvas").then((m) => m.ShaderBackdropCanvas),
  { ssr: false },
);

/* Same gate pattern as the hero 3D stage: server render and first paint show
   the CSS-only backdrop, the client adds the shader layer only when the query
   matches, and it re-evaluates on resize / reduced-motion changes. */
const BACKDROP_QUERY = "(min-width: 768px) and (prefers-reduced-motion: no-preference)";

function subscribeBackdrop(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(BACKDROP_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getBackdropSnapshot() {
  return window.matchMedia(BACKDROP_QUERY).matches;
}

export function ShaderBackdrop() {
  const show = useSyncExternalStore(subscribeBackdrop, getBackdropSnapshot, () => false);
  if (!show) return null;
  return (
    <BackdropBoundary>
      <ShaderBackdropCanvas />
    </BackdropBoundary>
  );
}
