"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import * as THREE from "three";
import TexasMapFloor from "@/components/canvas/TexasMapFloor";
import GlowNode from "@/components/canvas/GlowNode";
import FlowPacket from "@/components/canvas/FlowPacket";
import AtlasCard from "@/components/ui/AtlasCard";
import { TEXAS_CITIES_GEO, GENERATION_SITES, projectLonLat } from "@/lib/texasGeo";

const SITE_COLOR: Record<string, string> = {
  wind: "#94a3b8",
  solar: "#f5a623",
  plant: "#f97316",
};

export default function TexasMapMockup() {
  const austin = TEXAS_CITIES_GEO.find((c) => c.isFocus)!;
  const [ax, az] = projectLonLat(austin.lon, austin.lat);
  const plant = GENERATION_SITES.find((s) => s.id === "gulf-plant")!;
  const [px, pz] = projectLonLat(plant.lon, plant.lat);

  return (
    <main className="relative h-screen w-full overflow-hidden bg-[#050a14]">
      <Canvas camera={{ position: [0, 9, -9], fov: 42 }} gl={{ antialias: true }}>
        <color attach="background" args={["#050a14"]} />
        <fog attach="fog" args={["#050a14", 9, 26]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[3, 8, -4]} intensity={0.5} />
        <Stars radius={50} depth={35} count={1000} factor={2} saturation={0} fade speed={0.3} />

        <Suspense fallback={null}>
          <TexasMapFloor />

          {TEXAS_CITIES_GEO.map((c) => {
            const [x, z] = projectLonLat(c.lon, c.lat);
            return (
              <GlowNode
                key={c.id}
                position={[x, c.isFocus ? 0.06 : 0.04, z]}
                color={c.isFocus ? "#39ff14" : "#7dd3fc"}
                size={c.isFocus ? 0.1 : 0.06}
                pulse={c.isFocus}
                intensity={c.isFocus ? 2 : 1}
              />
            );
          })}

          {GENERATION_SITES.map((s) => {
            const [x, z] = projectLonLat(s.lon, s.lat);
            return (
              <GlowNode
                key={s.id}
                position={[x, 0.03, z]}
                color={SITE_COLOR[s.kind]}
                size={0.045}
                intensity={1.2}
              />
            );
          })}

          <FlowPacket
            start={new THREE.Vector3(px, 0.05, pz)}
            end={new THREE.Vector3(ax, 0.05, az)}
            color="#7df9ff"
            speed={0.12}
          />
        </Suspense>
      </Canvas>

      <AtlasCard
        kicker="ERCOT · The Texas Interconnection"
        title="Texas runs its own grid."
        body="Texas is the only state with its own independent power grid, built specifically to stay outside federal regulation. Every chapter of this story happens somewhere on this map."
      />
    </main>
  );
}
