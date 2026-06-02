"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";

const orbitNodes = [
  { label: "Lead velocity", value: "4.3x", tone: "gold", x: "16%", y: "18%" },
  { label: "Systems online", value: "05", tone: "silver", x: "74%", y: "20%" },
  { label: "Response lag", value: "-82%", tone: "gold", x: "14%", y: "74%" },
  { label: "Live automations", value: "128", tone: "silver", x: "72%", y: "78%" },
] as const;

export function LuxuryHeroStage() {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

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
        const rect = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        setTilt({ x, y });
      }}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
    >
      <div className="luxury-stage-grid" />
      <div className="luxury-stage-aurora luxury-stage-aurora-a" />
      <div className="luxury-stage-aurora luxury-stage-aurora-b" />
      <div className="luxury-stage-aurora luxury-stage-aurora-c" />

      <div className="luxury-stage-core">
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
