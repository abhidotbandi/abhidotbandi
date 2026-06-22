"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import GlowNode from "./GlowNode";
import FlowPacket from "./FlowPacket";
import { MACRO_NODES, MACRO_LINKS, COLORS } from "@/lib/network";

function nodePos(id: string): THREE.Vector3 {
  const n = MACRO_NODES.find((node) => node.id === id)!;
  return new THREE.Vector3(...n.position);
}

export default function MacroNetwork() {
  const links = useMemo(
    () =>
      MACRO_LINKS.map(([a, b], i) => {
        const nodeA = MACRO_NODES.find((n) => n.id === a)!;
        return {
          key: `${a}-${b}`,
          start: nodePos(a),
          end: nodePos(b),
          color: COLORS[nodeA.interconnection],
          offset: (i * 0.37) % 1,
        };
      }),
    []
  );

  return (
    <group>
      {MACRO_NODES.map((n) => (
        <GlowNode
          key={n.id}
          position={n.position}
          color={COLORS[n.interconnection]}
          size={n.isHub ? 0.26 : 0.15}
          pulse={n.isHub}
          intensity={n.isHub ? 2.4 : 1.2}
        />
      ))}

      {links.map(({ key, start, end, color, offset }) => (
        <group key={key}>
          <Line points={[start, end]} color="#22324a" lineWidth={1} transparent opacity={0.7} />
          <FlowPacket start={start} end={end} color={color} speed={0.07} offset={offset} />
        </group>
      ))}
    </group>
  );
}
