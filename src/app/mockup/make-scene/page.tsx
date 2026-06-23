"use client";

import { Suspense, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import * as THREE from "three";
import AtlasCard from "@/components/ui/AtlasCard";

const ELECTRON = "#7df9ff";

function WindTurbine({ position }: { position: [number, number, number] }) {
  const blades = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (blades.current) blades.current.rotation.z += delta * 1.6;
  });

  return (
    <group position={position}>
      <mesh position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.035, 0.05, 1.8, 8]} />
        <meshStandardMaterial color="#cbd5e1" />
      </mesh>
      <group ref={blades} position={[0, 1.8, 0.08]}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} rotation={[0, 0, (i * Math.PI * 2) / 3]} position={[0, 0.42, 0]}>
            <boxGeometry args={[0.07, 0.85, 0.015]} />
            <meshStandardMaterial color="#e2e8f0" />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function SolarArray({ position }: { position: [number, number, number] }) {
  const panels: [number, number][] = [
    [-0.5, -0.3], [0, -0.3], [0.5, -0.3],
    [-0.5, 0.3], [0, 0.3], [0.5, 0.3],
  ];
  return (
    <group position={position} rotation={[-0.5, 0, 0]}>
      {panels.map(([x, z], i) => (
        <mesh key={i} position={[x, 0, z]}>
          <boxGeometry args={[0.42, 0.02, 0.26]} />
          <meshStandardMaterial color="#1e3a8a" emissive="#1d4ed8" emissiveIntensity={0.3} />
        </mesh>
      ))}
    </group>
  );
}

function PowerPlant({ position }: { position: [number, number, number] }) {
  const glow = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (glow.current) glow.current.emissiveIntensity = 1.6 + Math.sin(clock.elapsedTime * 3) * 0.5;
  });

  return (
    <group position={position}>
      <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[0.7, 0.7, 0.5]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <mesh position={[-0.25, 0.95, 0]}>
        <cylinderGeometry args={[0.08, 0.1, 0.6, 10]} />
        <meshStandardMaterial color="#475569" />
      </mesh>
      <mesh position={[-0.25, 1.3, 0]}>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshStandardMaterial ref={glow} color="#f97316" emissive="#f97316" emissiveIntensity={1.8} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Electron() {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const start = new THREE.Vector3(-0.25, 1.3, 0);
  const end = new THREE.Vector3(2.6, 1.6, -1.2);

  useFrame(({ clock }) => {
    const t = (clock.elapsedTime * 0.18) % 1;
    if (ref.current) {
      ref.current.position.lerpVectors(start, end, t);
      const s = 1 + Math.sin(clock.elapsedTime * 8) * 0.15;
      ref.current.scale.setScalar(s);
    }
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.05, 12, 12]} />
      <meshBasicMaterial ref={mat} color={ELECTRON} toneMapped={false} />
    </mesh>
  );
}

export default function MakeSceneMockup() {
  return (
    <main className="relative h-screen w-full overflow-hidden bg-[#050a14]">
      <Canvas camera={{ position: [2.6, 1.8, 3.4], fov: 45 }} gl={{ antialias: true }}>
        <color attach="background" args={["#050a14"]} />
        <fog attach="fog" args={["#050a14", 4, 14]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[3, 5, 2]} intensity={0.7} />
        <Stars radius={50} depth={35} count={1200} factor={2} saturation={0} fade speed={0.3} />
        <gridHelper args={[12, 24, "#1e3a5f", "#0f1c2e"]} position={[0, -0.02, 0]}>
          <lineBasicMaterial attach="material" transparent opacity={0.3} toneMapped={false} />
        </gridHelper>

        <Suspense fallback={null}>
          <PowerPlant position={[-0.2, 0, 0]} />
          <WindTurbine position={[1.1, 0, -0.6]} />
          <SolarArray position={[-1.2, 0.05, -0.5]} />
          <Electron />
        </Suspense>
      </Canvas>

      <AtlasCard
        kicker="Pillar 1 · Make"
        title="An electron is born."
        body="Spinning turbines, burning fuel, or sunlight on a panel all do the same thing: push electrons through a wire. That's where every watt starts."
        activePillar={0}
      />
    </main>
  );
}
