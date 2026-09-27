"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { sky } from "@/lib/atlas/timeOfDay";
import { useAtlas } from "@/lib/atlas/store";
import Terrain, { CentralTerrain } from "./Terrain";
import Sky from "./Sky";
import Buildings from "./Buildings";
import { MapLines } from "./Lines";
import Beacons from "./Beacons";
import RedLine from "./RedLine";
import CameraDirector from "./CameraDirector";
import Bats from "./Bats";
import Plume from "./Plume";
import Traffic from "./Traffic";
import RiverLife from "./RiverLife";
import { LabelDriver } from "../ui/labels";
import type { PreparedScene } from "./prepare";

/** Light for the few lit (non-custom-shader) meshes: the train, bats and plume. */
function Lights() {
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    const n = sky.uNight.value;
    if (hemi.current) {
      hemi.current.color.copy(sky.uAmbient.value);
      hemi.current.intensity = 1.6 - n * 1.1;
    }
    if (sun.current) {
      sun.current.color.copy(sky.uSunColor.value);
      sun.current.intensity = 2.2 * (1 - n);
      sun.current.position.copy(sky.uSunDir.value).multiplyScalar(50);
    }
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={["#ffffff", "#8a7a66", 1.4]} />
      <directionalLight ref={sun} position={[20, 40, 10]} intensity={2} />
    </>
  );
}

/** Lifts the loader once the scene has actually drawn, not just mounted. */
function ReadySignal() {
  const frames = useRef(0);
  useFrame(() => {
    if (frames.current < 0) return;
    if (++frames.current >= 2) {
      frames.current = -1;
      useAtlas.getState().setReady();
    }
  });
  return null;
}

export default function AtlasCanvas({ scene }: { scene: PreparedScene }) {
  const setWebglFailed = useAtlas((s) => s.setWebglFailed);
  const dpr = useMemo<[number, number]>(() => [1, scene.lowPower ? 1.5 : 2], [scene.lowPower]);
  const { assets, tex, buildings, ground } = scene;
  const highways = useMemo(() => [...assets.vectors.roads.motorway, ...assets.vectors.roads.trunk], [assets]);

  return (
    <Canvas
      flat
      dpr={dpr}
      camera={{ fov: 32, near: 0.05, far: 500, position: [0, 70, 60] }}
      gl={{ antialias: true, powerPreference: "high-performance", alpha: false, stencil: false }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", () => setWebglFailed(), { once: true });
      }}
      style={{ position: "fixed", inset: 0 }}
    >
      <CameraDirector height={ground} />
      <Lights />
      <Sky />
      <Terrain tex={tex} segments={scene.terrainSegments} />
      <CentralTerrain
        tex={scene.centralTex}
        baseTex={tex}
        grid={scene.patch}
        sdfK={assets.meta.central.surface.sdfK}
      />
      <MapLines assets={assets} ground={ground} />
      <Buildings geometry={buildings.geometry} />
      <Buildings geometry={scene.centralBuildings.geometry} />
      <RedLine vectors={assets.vectors} height={ground} />
      <Beacons height={ground} siteTop={scene.siteTop} />
      {!scene.lowPower && <Traffic lines={highways} height={ground} count={1400} />}
      <RiverLife central={assets.central} ground={ground} lowPower={scene.lowPower} />
      <Bats height={ground} count={scene.lowPower ? 1500 : 4000} />
      <Plume height={ground} />
      <LabelDriver />
      <ReadySignal />
    </Canvas>
  );
}
