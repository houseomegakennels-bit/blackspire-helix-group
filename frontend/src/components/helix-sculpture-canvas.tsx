"use client";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer, ContactShadows } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import { BufferGeometry, Float32BufferAttribute, Group, DoubleSide, MathUtils } from "three";

function ribbon(phase: number) {
  const vertices: number[] = [], indices: number[] = [];
  const segments = 180;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, angle = t * Math.PI * 3.5 + phase;
    const radius = .77 + Math.sin(t * Math.PI) * .25;
    const width = .11 + Math.sin(t * Math.PI) * .17;
    for (let j = 0; j < 4; j++) {
      const r = radius + ((j === 1 || j === 2) ? width : -width);
      vertices.push(Math.cos(angle) * r, (t - .5) * 4.5 + (j < 2 ? -.045 : .045), Math.sin(angle) * r);
    }
    if (i < segments) {
      const a = i * 4;
      for (let j = 0; j < 4; j++) { const k = (j + 1) % 4; indices.push(a+j,a+k,a+4+j,a+k,a+4+k,a+4+j); }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}
function Sculpture({ active }: { active: boolean }) {
  const group = useRef<Group>(null);
  const geometries = useMemo(() => [ribbon(0), ribbon(Math.PI)], []);
  useEffect(() => () => geometries.forEach(g => g.dispose()), [geometries]);
  useFrame((state, dt) => {
    if (!group.current || !active) return;
    group.current.rotation.y += Math.min(dt, .05) * .12;
    group.current.rotation.x = MathUtils.damp(group.current.rotation.x, state.pointer.y * .08, 2, dt);
    group.current.rotation.z = MathUtils.damp(group.current.rotation.z, -.3 + state.pointer.x * .04, 2, dt);
  });
  return <group ref={group} rotation={[0, .55, -.3]} position={[0, .2, 0]}>
    {geometries.map((geometry, i) => <mesh key={i} geometry={geometry}>
      <meshStandardMaterial color={i ? "#a89975" : "#e6c486"} metalness={.62} roughness={.26} side={DoubleSide} />
    </mesh>)}
  </group>;
}
export default function HelixSculptureCanvas({ active, onReady, onLost }: { active: boolean; onReady: () => void; onLost: () => void }) {
  const cleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cleanup.current?.(), []);
  return <div aria-hidden="true" style={{ position: "absolute", inset: 0 }}>
    <Canvas camera={{ position: [0, .5, 8.3], fov: 39 }} dpr={[1, 1.5]} frameloop={active ? "always" : "demand"} gl={{ antialias: true, alpha: true, powerPreference: "low-power" }} onCreated={({ gl }) => {
      const lost = () => onLost();
      const restored = () => onReady();
      gl.domElement.addEventListener("webglcontextlost", lost);
      gl.domElement.addEventListener("webglcontextrestored", restored);
      cleanup.current = () => { gl.domElement.removeEventListener("webglcontextlost", lost); gl.domElement.removeEventListener("webglcontextrestored", restored); };
      onReady();
    }}>
      <ambientLight intensity={1.2} />
      <directionalLight position={[-3, 1, 5]} intensity={2} color="#fff8e8" />
      <directionalLight position={[3, 4, 5]} intensity={3} color="#fff4d9" />
      <Environment resolution={128}>
        <Lightformer intensity={4} position={[-3, 2, 3]} scale={[3, 6, 1]} />
        <Lightformer intensity={3} position={[3, 1, 2]} scale={[2, 5, 1]} color="#dbc292" />
        <Lightformer intensity={2} position={[0, 4, -2]} rotation={[Math.PI / 2, 0, 0]} scale={[4, 4, 1]} />
      </Environment>
      <Sculpture active={active} />
      <ContactShadows position={[0, -2.55, 0]} opacity={.5} scale={8} blur={2.5} far={5} resolution={128} frames={1} color="#000000" />
    </Canvas>
  </div>;
}
