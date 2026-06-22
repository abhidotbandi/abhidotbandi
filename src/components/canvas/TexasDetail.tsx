"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import GlowNode from "./GlowNode";
import { ERCOT_NODE, TEXAS_CITIES, COLORS, TEXAS_LOCAL_SCALE } from "@/lib/network";
import { useGridStore } from "@/lib/store";
import { smoothstep } from "@/lib/chapters";

export default function TexasDetail() {
  const group = useRef<THREE.Group>(null);

  const cities = useMemo(
    () =>
      TEXAS_CITIES.map((c) => ({
        ...c,
        local: [
          c.offset[0] * TEXAS_LOCAL_SCALE,
          c.offset[1] * TEXAS_LOCAL_SCALE,
          c.offset[2] * TEXAS_LOCAL_SCALE,
        ] as [number, number, number],
      })),
    []
  );

  useFrame(() => {
    const p = useGridStore.getState().scrollProgress;
    const reveal = smoothstep(0.22, 0.34, p);
    if (group.current) {
      const s = Math.max(0.001, reveal);
      group.current.scale.lerp(new THREE.Vector3(s, s, s), 0.15);
    }
  });

  return (
    <group ref={group} position={ERCOT_NODE.position} scale={0.001}>
      {cities.map((c) => (
        <group key={c.id}>
          <Line
            points={[new THREE.Vector3(0, 0, 0), new THREE.Vector3(...c.local)]}
            color={COLORS.ercot}
            lineWidth={1}
            transparent
            opacity={0.45}
          />
          <GlowNode
            position={c.local}
            color={COLORS.ercot}
            size={c.isFocus ? 0.13 : 0.09}
            pulse={c.isFocus}
            intensity={c.isFocus ? 2 : 1.1}
          />
        </group>
      ))}
    </group>
  );
}
