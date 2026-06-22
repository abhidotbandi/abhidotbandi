"use client";

import { Suspense, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { ScrollControls, Scroll, Stars } from "@react-three/drei";
import CameraRig from "./CameraRig";
import MacroNetwork from "./MacroNetwork";
import TexasDetail from "./TexasDetail";
import HouseScene from "./HouseScene";
import Effects from "./Effects";
import { SCROLL_PAGES } from "@/lib/chapters";

export default function Scene({ children }: { children: ReactNode }) {
  return (
    <Canvas
      camera={{ position: [0, 9, 14], fov: 45, near: 0.1, far: 100 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#050a14"]} />
      <fog attach="fog" args={["#050a14", 9, 28]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 4]} intensity={0.55} />
      <hemisphereLight args={["#1e3a5f", "#050a14", 0.4]} />
      <Stars radius={50} depth={35} count={1500} factor={2} saturation={0} fade speed={0.3} />

      <gridHelper args={[20, 40, "#1e3a5f", "#0f1c2e"]} position={[0, -0.02, 0]}>
        <lineBasicMaterial attach="material" transparent opacity={0.3} toneMapped={false} />
      </gridHelper>

      <ScrollControls pages={SCROLL_PAGES} damping={0.2}>
        <CameraRig />
        <Suspense fallback={null}>
          <MacroNetwork />
          <TexasDetail />
          <HouseScene />
        </Suspense>
        <Scroll html style={{ width: "100%" }}>
          {children}
        </Scroll>
      </ScrollControls>

      <Effects />
    </Canvas>
  );
}
