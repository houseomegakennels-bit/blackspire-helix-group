"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useRef, useMemo } from "react";
import * as THREE from "three";

/* ── Orbital ring ── */
function OrbitalRing({
  radius,
  tubeRadius,
  color,
  speed,
  tiltX = 0,
  tiltZ = 0,
}: {
  radius: number;
  tubeRadius: number;
  color: string;
  speed: number;
  tiltX?: number;
  tiltZ?: number;
}) {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((_, delta) => {
    ref.current.rotation.y += delta * speed;
  });
  const geo = useMemo(() => new THREE.TorusGeometry(radius, tubeRadius, 2, 128), [radius, tubeRadius]);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
      }),
    [color],
  );
  return <mesh ref={ref} geometry={geo} material={mat} rotation={[tiltX, 0, tiltZ]} />;
}

/* ── Floating data node (billboard label is CSS-side; this is just a glow sphere) ── */
function DataNode({
  position,
  color,
  size = 0.045,
  phaseOffset = 0,
}: {
  position: [number, number, number];
  color: string;
  size?: number;
  phaseOffset?: number;
}) {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => {
    ref.current.position.y = position[1] + Math.sin(clock.elapsedTime * 0.7 + phaseOffset) * 0.08;
  });
  const geo = useMemo(() => new THREE.SphereGeometry(size, 16, 16), [size]);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
      }),
    [color],
  );
  return <mesh ref={ref} geometry={geo} material={mat} position={position} />;
}

/* ── Particle field ── */
function ParticleField({ count = 600 }: { count?: number }) {
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 6;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 6;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 6;
    }
    return arr;
  }, [count]);

  const ref = useRef<THREE.Points>(null!);
  useFrame((_, delta) => {
    ref.current.rotation.y += delta * 0.025;
  });

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);

  const mat = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: 0.012,
        color: "#d4a843",
        transparent: true,
        opacity: 0.45,
        sizeAttenuation: true,
      }),
    [],
  );

  return <points ref={ref} geometry={geo} material={mat} />;
}

/* ── Core sphere ── */
function CoreSphere() {
  const meshRef = useRef<THREE.Mesh>(null!);
  const wireRef = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    meshRef.current.rotation.y = t * 0.08;
    meshRef.current.rotation.x = Math.sin(t * 0.04) * 0.15;
    wireRef.current.rotation.y = t * 0.06;
    wireRef.current.rotation.z = t * 0.03;
  });

  const sphereGeo = useMemo(() => new THREE.SphereGeometry(0.52, 64, 64), []);
  const wireGeo = useMemo(() => new THREE.SphereGeometry(0.56, 24, 24), []);

  const coreMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#0a0e14",
        transparent: true,
        opacity: 0.92,
      }),
    [],
  );

  const wireMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#c17f24",
        wireframe: true,
        transparent: true,
        opacity: 0.18,
      }),
    [],
  );

  return (
    <group>
      <mesh ref={meshRef} geometry={sphereGeo} material={coreMat} />
      <mesh ref={wireRef} geometry={wireGeo} material={wireMat} />
    </group>
  );
}

/* ── Camera pointer-follow rig ── */
function CameraRig({ pointer }: { pointer: { x: number; y: number } }) {
  const { camera } = useThree();
  useFrame(() => {
    camera.position.x += (pointer.x * 0.6 - camera.position.x) * 0.04;
    camera.position.y += (-pointer.y * 0.4 - camera.position.y) * 0.04;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

/* ── Main scene ── */
export function HeroScene3D({ pointer }: { pointer: { x: number; y: number } }) {
  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[3, 3, 3]} intensity={1.2} color="#d4a843" />
      <pointLight position={[-3, -2, -2]} intensity={0.5} color="#3fb6c9" />

      <CameraRig pointer={pointer} />

      <ParticleField count={700} />

      <CoreSphere />

      {/* Orbital rings */}
      <OrbitalRing radius={0.92} tubeRadius={0.004} color="#d4a843" speed={0.28} tiltX={Math.PI / 2} />
      <OrbitalRing radius={1.22} tubeRadius={0.003} color="#3fb6c9" speed={-0.18} tiltX={Math.PI / 3} tiltZ={Math.PI / 6} />
      <OrbitalRing radius={1.56} tubeRadius={0.002} color="#8b5cf6" speed={0.11} tiltX={Math.PI / 7} tiltZ={-Math.PI / 5} />
      <OrbitalRing radius={1.9} tubeRadius={0.002} color="#d4a843" speed={-0.07} tiltX={-Math.PI / 4} tiltZ={Math.PI / 8} />

      {/* Data nodes */}
      <DataNode position={[-1.1, 0.6, 0]} color="#d4a843" phaseOffset={0} />
      <DataNode position={[1.1, -0.5, 0.3]} color="#3fb6c9" phaseOffset={2.1} />
      <DataNode position={[0.4, 1.2, -0.6]} color="#8b5cf6" phaseOffset={4.2} />
      <DataNode position={[-0.8, -1.0, 0.2]} color="#d4a843" size={0.035} phaseOffset={1.5} />
    </>
  );
}
