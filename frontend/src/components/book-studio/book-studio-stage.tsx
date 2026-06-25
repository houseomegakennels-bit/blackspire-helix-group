"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";

const nodes = [
  { label: "Canonical looks", value: "Lock faces before bulk render", x: "10%", y: "18%" },
  { label: "Scene queue", value: "Key scenes first", x: "68%", y: "15%" },
  { label: "Reference pull", value: "Import art made while writing", x: "14%", y: "76%" },
  { label: "Public output", value: "Chapter MP4 players", x: "70%", y: "74%" },
] as const;

export function BookStudioStage() {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const style = useMemo(
    () =>
      ({
        "--book-stage-rotate-x": `${tilt.y * -12}deg`,
        "--book-stage-rotate-y": `${tilt.x * 12}deg`,
        "--book-stage-shift-x": `${tilt.x * 26}px`,
        "--book-stage-shift-y": `${tilt.y * 24}px`,
      }) as CSSProperties,
    [tilt],
  );

  return (
    <div
      className="book-stage"
      style={style}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        setTilt({ x, y });
      }}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
    >
      <div className="book-stage-grid" />
      <div className="book-stage-glow book-stage-glow-a" />
      <div className="book-stage-glow book-stage-glow-b" />
      <div className="book-stage-glow book-stage-glow-c" />

      <div className="book-stage-core">
        <div className="book-stage-halo" />
        <div className="book-stage-halo book-stage-halo-b" />
        <div className="book-stage-plinth">
          <span className="book-stage-kicker">BLACKSPIRE BOOK STUDIO</span>
          <strong className="book-stage-title">Scene-to-Audiobook Pipeline</strong>
          <span className="book-stage-copy">Import. Lock. Render. Voice. Publish.</span>
        </div>
      </div>

      {nodes.map((node, index) => (
        <article
          key={node.label}
          className="book-stage-node"
          style={
            {
              "--book-node-x": node.x,
              "--book-node-y": node.y,
              "--book-node-delay": `${index * 0.7}s`,
            } as CSSProperties
          }
        >
          <span className="book-stage-node-label">{node.label}</span>
          <strong className="book-stage-node-value">{node.value}</strong>
        </article>
      ))}

      <div className="book-stage-rail book-stage-rail-a" />
      <div className="book-stage-rail book-stage-rail-b" />
    </div>
  );
}
