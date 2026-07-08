"use client";

import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { Suspense, useEffect, useRef, useState, useCallback } from "react";

import { HeroScene3D } from "@/components/luxury-hero-stage-3d";

export function LuxuryHeroStageCanvas({ onReady }: { onReady?: () => void } = {}) {
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  /* Readiness must be detected from the DOM side: React effects inside the
     R3F canvas tree (and the Canvas onCreated prop) never flush under this
     React 19 + R3F 9 pairing, so no in-tree callback can report success.
     A canvas element still mounted a frame after mount means context
     creation succeeded — a failed context throws during mount and the
     error boundary above unmounts this whole subtree. */
  useEffect(() => {
    if (!onReady) return;
    let raf = 0;
    const check = () => {
      if (canvasRef.current?.querySelector("canvas")) onReady();
      else raf = requestAnimationFrame(check);
    };
    raf = requestAnimationFrame(check);
    return () => cancelAnimationFrame(raf);
  }, [onReady]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPointer({
      x: (e.clientX - rect.left) / rect.width - 0.5,
      y: (e.clientY - rect.top) / rect.height - 0.5,
    });
  }, []);

  const handlePointerLeave = useCallback(() => setPointer({ x: 0, y: 0 }), []);

  return (
    <div
      ref={canvasRef}
      className="absolute inset-0 z-10"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <Canvas
        camera={{ position: [0, 0, 3.8], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 1.5]}
        style={{ background: "transparent" }}
        onCreated={() => onReady?.()}
      >
        <Suspense fallback={null}>
          <HeroScene3D pointer={pointer} />
          {/* Bloom lifts the gold rings/particles into a cinematic glow.
              Low threshold + mipmapBlur keeps it soft; the canvas stays
              transparent so the CSS aurora layers behind it remain visible. */}
          <EffectComposer>
            <Bloom mipmapBlur intensity={0.65} luminanceThreshold={0.2} luminanceSmoothing={0.3} />
          </EffectComposer>
        </Suspense>
      </Canvas>
    </div>
  );
}
