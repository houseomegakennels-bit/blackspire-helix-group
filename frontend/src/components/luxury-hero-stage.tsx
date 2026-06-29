"use client";

import dynamic from "next/dynamic";
import type { CSSProperties, ReactNode } from "react";
import { Component, useMemo, useState, useSyncExternalStore } from "react";

import { ecosystemProjects } from "@/lib/ecosystem";

/* If the WebGL canvas throws (context creation fails, e.g. WebGL disabled in
   enterprise/remote browsers), render nothing and notify the parent so the CSS
   hero core stays visible instead of leaving an empty stage. */
class HeroCanvasBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/* Lazy-load the heavy canvas — only on desktop, only if motion is allowed */
const LuxuryHeroStageCanvas = dynamic(
  () => import("@/components/luxury-hero-stage-canvas").then((m) => m.LuxuryHeroStageCanvas),
  { ssr: false },
);

/* Gate the 3D scene behind desktop width + motion preference.
   useSyncExternalStore is the idiomatic way to read a browser media query:
   server render and first paint return false (CSS fallback shows), the client
   swaps to 3D only when the query matches, and it re-evaluates automatically
   on viewport resize or reduced-motion preference change — with no
   setState-in-effect cascade. */
const HERO_3D_QUERY = "(min-width: 768px) and (prefers-reduced-motion: no-preference)";

function subscribeHero3D(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(HERO_3D_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getHero3DSnapshot() {
  return window.matchMedia(HERO_3D_QUERY).matches;
}

const orbitNodeBase = [
  { label: "Lead velocity", value: "4.3x", tone: "gold", x: "16%", y: "18%" },
  { label: "Response lag", value: "-82%", tone: "gold", x: "14%", y: "74%" },
  { label: "Live automations", value: "128", tone: "silver", x: "72%", y: "78%" },
] as const;

export function LuxuryHeroStage() {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const show3D = useSyncExternalStore(subscribeHero3D, getHero3DSnapshot, () => false);
  /* Only treat 3D as active once the canvas has actually created its WebGL
     context (onReady). Until then — and if it fails — the CSS core stays. */
  const [canvasReady, setCanvasReady] = useState(false);
  const stage3DActive = show3D && canvasReady;

  const systemCount = String(ecosystemProjects.length).padStart(2, "0");
  const orbitNodes = [
    orbitNodeBase[0],
    { label: "Systems online", value: systemCount, tone: "silver", x: "74%", y: "20%" },
    orbitNodeBase[1],
    orbitNodeBase[2],
  ] as const;

  const stageStyle = useMemo(
    () =>
      ({
        "--stage-rotate-x": `${tilt.y * -10}deg`,
        "--stage-rotate-y": `${tilt.x * 12}deg`,
        "--stage-shift-x": `${tilt.x * 18}px`,
        "--stage-shift-y": `${tilt.y * 16}px`,
      }) as CSSProperties,
    [tilt],
  );

  return (
    <div
      className="luxury-stage"
      style={stageStyle}
      onPointerMove={(event) => {
        if (stage3DActive) return; /* active 3D canvas handles its own pointer tracking */
        const rect = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        setTilt({ x, y });
      }}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
    >
      {/* CSS layers — always present, sit behind the 3D canvas */}
      <div className="luxury-stage-grid" />
      <div className="luxury-stage-aurora luxury-stage-aurora-a" />
      <div className="luxury-stage-aurora luxury-stage-aurora-b" />
      <div className="luxury-stage-aurora luxury-stage-aurora-c" />

      {/* CSS core — hidden only once 3D has actually rendered, so a failed/
          unavailable WebGL context still shows the core */}
      <div className={`luxury-stage-core${stage3DActive ? " opacity-0" : ""}`}>
        <div className="luxury-stage-ring luxury-stage-ring-a" />
        <div className="luxury-stage-ring luxury-stage-ring-b" />
        <div className="luxury-stage-ring luxury-stage-ring-c" />
        <div className="luxury-stage-pulse" />
        <div className="luxury-stage-spire" />
        <div className="luxury-stage-crosshair" />
        <div className="luxury-stage-plate">
          <span className="luxury-stage-kicker">Command surface</span>
          <span className="luxury-stage-title">AI Employee Grid</span>
        </div>
      </div>

      {/* 3D WebGL canvas — lazy-loaded, desktop + motion-ok only.
          Wrapped so a context-creation failure falls back to the CSS core. */}
      {show3D && (
        <HeroCanvasBoundary onError={() => setCanvasReady(false)}>
          <LuxuryHeroStageCanvas onReady={() => setCanvasReady(true)} />
        </HeroCanvasBoundary>
      )}

      {/* Floating data nodes — always visible, sit above canvas */}
      {orbitNodes.map((node, index) => (
        <article
          key={node.label}
          className={`luxury-stage-node luxury-stage-node-${node.tone}`}
          style={
            {
              "--node-x": node.x,
              "--node-y": node.y,
              "--node-delay": `${index * 0.9}s`,
            } as CSSProperties
          }
        >
          <span className="luxury-stage-node-label">{node.label}</span>
          <strong className="luxury-stage-node-value">{node.value}</strong>
        </article>
      ))}

      <div className="luxury-stage-rail luxury-stage-rail-a" />
      <div className="luxury-stage-rail luxury-stage-rail-b" />
      <div className="luxury-stage-rail luxury-stage-rail-c" />
    </div>
  );
}
