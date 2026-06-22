"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface FlowPacketProps {
  start: THREE.Vector3;
  end: THREE.Vector3;
  color: string;
  speed?: number;
  offset?: number;
  size?: number;
}

export default function FlowPacket({
  start,
  end,
  color,
  speed = 0.06,
  offset = 0,
  size = 0.045,
}: FlowPacketProps) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = (clock.elapsedTime * speed + offset) % 1;
    ref.current.position.lerpVectors(start, end, t);
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[size, 8, 8]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}
