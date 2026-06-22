"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import FlowPacket from "./FlowPacket";
import {
  AUSTIN_CITY,
  COLORS,
  ERCOT_NODE,
  NEIGHBORHOOD_HOUSE_SLOTS,
  texasCityWorldPos,
} from "@/lib/network";
import { useGridStore } from "@/lib/store";
import { smoothstep } from "@/lib/chapters";

const NEIGHBORHOOD_SCALE = 0.22;
const austinPos = texasCityWorldPos(AUSTIN_CITY);

function FocusHouse() {
  const houseGroup = useRef<THREE.Group>(null);
  const gridLineMat = useRef<THREE.MeshBasicMaterial>(null);
  const batteryMat = useRef<THREE.MeshStandardMaterial>(null);
  const windowMat = useRef<THREE.MeshStandardMaterial>(null);
  const prevOutage = useRef(false);
  const flickerUntil = useRef(0);

  useFrame(({ clock }) => {
    const state = useGridStore.getState();
    const p = state.scrollProgress;
    const reveal = smoothstep(0.46, 0.58, p);

    if (houseGroup.current) {
      const s = Math.max(0.001, reveal);
      houseGroup.current.scale.lerp(new THREE.Vector3(s, s, s), 0.15);
    }

    const outage = state.outageActive;
    if (outage && !prevOutage.current) {
      flickerUntil.current = clock.elapsedTime + 0.4;
    }
    prevOutage.current = outage;

    if (gridLineMat.current) {
      const target = outage ? 0.03 : 0.85;
      gridLineMat.current.opacity = THREE.MathUtils.lerp(gridLineMat.current.opacity, target, 0.12);
    }

    if (batteryMat.current) {
      const idle = 1.1 + Math.sin(clock.elapsedTime * 1.6) * 0.3;
      const target = outage ? 2.4 : idle;
      batteryMat.current.emissiveIntensity = THREE.MathUtils.lerp(
        batteryMat.current.emissiveIntensity,
        target,
        0.15
      );
    }

    if (windowMat.current) {
      const flickering = clock.elapsedTime < flickerUntil.current;
      const flickerPhase = (flickerUntil.current - clock.elapsedTime) / 0.4;
      const lit = flickering ? (flickerPhase > 0.75 ? 0.05 : 1.6) : 1.6;
      windowMat.current.emissiveIntensity = THREE.MathUtils.lerp(
        windowMat.current.emissiveIntensity,
        lit,
        0.4
      );
    }
  });

  return (
    <group ref={houseGroup} scale={0.001}>
      <Line
        points={[
          [0, 0.15, 0],
          [0, 0.15, 1.4],
        ]}
        color={COLORS.ercot}
        lineWidth={1.5}
      >
        <meshBasicMaterial ref={gridLineMat} attach="material" color={COLORS.ercot} transparent opacity={0.85} toneMapped={false} />
      </Line>

      <mesh position={[0, 0.15, 0]}>
        <boxGeometry args={[0.42, 0.3, 0.42]} />
        <meshStandardMaterial color="#1f2937" />
      </mesh>
      <mesh position={[0, 0.35, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[0.32, 0.22, 4]} />
        <meshStandardMaterial color="#374151" />
      </mesh>
      <mesh position={[0.16, 0.16, 0.215]}>
        <planeGeometry args={[0.1, 0.1]} />
        <meshStandardMaterial
          ref={windowMat}
          color="#ffe9a8"
          emissive="#ffe9a8"
          emissiveIntensity={1.6}
          toneMapped={false}
        />
      </mesh>

      <mesh position={[-0.34, 0.1, 0.1]}>
        <boxGeometry args={[0.12, 0.22, 0.1]} />
        <meshStandardMaterial
          ref={batteryMat}
          color={COLORS.western}
          emissive={COLORS.western}
          emissiveIntensity={1.1}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[-0.34, 0.24, 0.1]}>
        <boxGeometry args={[0.1, 0.05, 0.08]} />
        <meshStandardMaterial color="#94a3b8" />
      </mesh>
    </group>
  );
}

function NeighborHouse({ slotIndex }: { slotIndex: number }) {
  const group = useRef<THREE.Group>(null);
  const offset = NEIGHBORHOOD_HOUSE_SLOTS[slotIndex];

  useFrame(() => {
    const active = useGridStore.getState().vppHouseCount > slotIndex;
    if (group.current) {
      const s = active ? 1 : 0.001;
      group.current.scale.lerp(new THREE.Vector3(s, s, s), 0.12);
    }
  });

  return (
    <group
      ref={group}
      position={[offset[0] * NEIGHBORHOOD_SCALE, 0, offset[1] * NEIGHBORHOOD_SCALE]}
      scale={0.001}
    >
      <mesh position={[0, 0.12, 0]}>
        <boxGeometry args={[0.34, 0.24, 0.34]} />
        <meshStandardMaterial color="#1f2937" />
      </mesh>
      <mesh position={[0, 0.28, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[0.26, 0.18, 4]} />
        <meshStandardMaterial color="#374151" />
      </mesh>
      <mesh position={[-0.24, 0.08, 0.08]}>
        <boxGeometry args={[0.08, 0.16, 0.07]} />
        <meshStandardMaterial color={COLORS.western} emissive={COLORS.western} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
    </group>
  );
}

function VppLines() {
  const ercotWorld = useMemo(() => new THREE.Vector3(...ERCOT_NODE.position), []);

  const houseLines = useMemo(
    () =>
      NEIGHBORHOOD_HOUSE_SLOTS.slice(1).map((offset) => {
        const pos = new THREE.Vector3(
          austinPos.x + offset[0] * NEIGHBORHOOD_SCALE,
          0.1,
          austinPos.z + offset[1] * NEIGHBORHOOD_SCALE
        );
        const geometry = new THREE.BufferGeometry().setFromPoints([pos, ercotWorld]);
        const material = new THREE.LineBasicMaterial({
          color: COLORS.ercot,
          transparent: true,
          opacity: 0,
          toneMapped: false,
        });
        const line = new THREE.Line(geometry, material);
        return { pos, line, material };
      }),
    [ercotWorld]
  );

  useFrame(() => {
    const count = useGridStore.getState().vppHouseCount;
    houseLines.forEach(({ material }, i) => {
      const active = count > i + 1;
      material.opacity = THREE.MathUtils.lerp(material.opacity, active ? 0.5 : 0, 0.12);
    });
  });

  return (
    <group>
      {houseLines.map(({ pos, line }, i) => (
        <group key={i}>
          <primitive object={line} />
          <FlowPacket start={pos} end={ercotWorld} color={COLORS.ercot} speed={0.18} offset={i * 0.13} size={0.035} />
        </group>
      ))}
    </group>
  );
}

export default function HouseScene() {
  return (
    <>
      <group position={[austinPos.x, austinPos.y, austinPos.z]}>
        <FocusHouse />
        {NEIGHBORHOOD_HOUSE_SLOTS.slice(1).map((_, i) => (
          <NeighborHouse key={i} slotIndex={i + 1} />
        ))}
      </group>
      <VppLines />
    </>
  );
}
