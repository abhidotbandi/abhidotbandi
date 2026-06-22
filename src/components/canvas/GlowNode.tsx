"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface GlowNodeProps {
  position: [number, number, number];
  color: string;
  size?: number;
  pulse?: boolean;
  intensity?: number;
}

export default function GlowNode({
  position,
  color,
  size = 0.14,
  pulse = false,
  intensity = 1.4,
}: GlowNodeProps) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(({ clock }) => {
    if (pulse && mat.current) {
      mat.current.emissiveIntensity = intensity + Math.sin(clock.elapsedTime * 2) * 0.4;
    }
  });

  return (
    <mesh position={position}>
      <sphereGeometry args={[size, 16, 16]} />
      <meshStandardMaterial
        ref={mat}
        color={color}
        emissive={color}
        emissiveIntensity={intensity}
        toneMapped={false}
      />
    </mesh>
  );
}
