"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import AtlasCard from "@/components/ui/AtlasCard";

export default function FoldHeroMockup() {
  return (
    <main className="relative h-screen w-full overflow-hidden bg-[#050a14]">
      <Canvas camera={{ position: [0, 9, 14], fov: 45 }} gl={{ antialias: true }}>
        <color attach="background" args={["#050a14"]} />
        <fog attach="fog" args={["#050a14", 9, 28]} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 8, 4]} intensity={0.55} />
        <hemisphereLight args={["#1e3a5f", "#050a14", 0.4]} />
        <Stars radius={50} depth={35} count={1500} factor={2} saturation={0} fade speed={0.3} />
        <gridHelper args={[20, 40, "#1e3a5f", "#0f1c2e"]} position={[0, -0.02, 0]}>
          <lineBasicMaterial attach="material" transparent opacity={0.3} toneMapped={false} />
        </gridHelper>
        <Suspense fallback={null} />
      </Canvas>

      <AtlasCard
        kicker="An interactive tour of the US energy grid"
        title="Follow one electron, from power plant to porch light."
        body="Every watt you use starts as a spark in a turbine or a solar cell. Scroll to follow it as it's made, moved, stored, and sold — down to the battery in a single Texas home."
        activePillar={undefined}
      />
    </main>
  );
}
