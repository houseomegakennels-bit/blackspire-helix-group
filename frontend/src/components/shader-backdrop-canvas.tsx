"use client";

import { GrainGradient } from "@paper-design/shaders-react";

/* Brand-gold grain gradient (Paper Shaders WebGL canvas). Colors stay in the
   Orbital Luxury family: near-black base with a deep amber swell, so the
   layer reads as atmosphere rather than a new palette. */
export function ShaderBackdropCanvas() {
  return (
    <GrainGradient
      className="luxury-shader-backdrop"
      colorBack="#000000"
      colors={["#0a0e14", "#231506", "#8a5a17"]}
      softness={0.85}
      intensity={0.32}
      noise={0.28}
      shape="wave"
      speed={0.25}
    />
  );
}
