"use client";
import dynamic from "next/dynamic";
import Image from "next/image";
import { Component, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
const Canvas = dynamic(() => import("./helix-sculpture-canvas"), { ssr: false });
const motionQuery = "(prefers-reduced-motion: no-preference)";
function subscribe(callback: () => void) {
  const media = window.matchMedia(motionQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
class CanvasBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}
export function HelixSculpture() {
  const root = useRef<HTMLDivElement>(null);
  const motion = useSyncExternalStore(subscribe, () => window.matchMedia(motionQuery).matches, () => false);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "100px" });
    if (root.current) observer.observe(root.current);
    const visibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  return (
    <div ref={root} style={{ position: "relative", height: "100%", width: "100%" }}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, opacity: ready && motion ? 0 : 1 }}>
        <Image src="/brand/helix-sculpture-still-v2.png" alt="" fill sizes="(max-width: 760px) 100vw, 55vw" style={{ objectFit: "contain" }} priority />
      </div>
      {motion && <CanvasBoundary onError={() => setReady(false)}><Canvas active={visible && pageVisible && !paused} onReady={() => setReady(true)} onLost={() => setReady(false)} /></CanvasBoundary>}
      {motion && ready && <button type="button" aria-pressed={paused} onClick={() => setPaused(p => !p)} style={{ position: "absolute", bottom: 24, right: 30, minHeight: 44, padding: "8px 14px", border: "1px solid #696b5c", borderRadius: 4, color: "#e1dfd5", fontSize: 12, background: "#10110fe6", cursor: "pointer" }}>{paused ? "Resume sculpture" : "Pause sculpture"}</button>}
    </div>
  );
}

