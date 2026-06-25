"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense, useRef, useState, useCallback } from "react";

import { HeroScene3D } from "@/components/luxury-hero-stage-3d";

export function LuxuryHeroStageCanvas() {
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

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
      >
        <Suspense fallback={null}>
          <HeroScene3D pointer={pointer} />
        </Suspense>
      </Canvas>
    </div>
  );
}
