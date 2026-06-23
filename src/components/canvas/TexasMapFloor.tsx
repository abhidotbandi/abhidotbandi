"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import { TX_OUTLINE, projectLonLat } from "@/lib/texasGeo";

export default function TexasMapFloor() {
  const geometry = useMemo(() => {
    const pts2d = TX_OUTLINE.map(([lon, lat]) => {
      const [x, z] = projectLonLat(lon, lat);
      return new THREE.Vector2(x, z);
    });
    const faces = THREE.ShapeUtils.triangulateShape(pts2d, []);
    const positions = new Float32Array(pts2d.length * 3);
    pts2d.forEach((p, i) => {
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = p.y;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(faces.flat());
    return geo;
  }, []);

  const outline = useMemo(() => {
    const pts = TX_OUTLINE.map(([lon, lat]) => {
      const [x, z] = projectLonLat(lon, lat);
      return new THREE.Vector3(x, 0.015, z);
    });
    pts.push(pts[0].clone());
    return pts;
  }, []);

  return (
    <group>
      <mesh geometry={geometry}>
        <meshBasicMaterial color="#0b1830" transparent opacity={0.92} side={THREE.DoubleSide} />
      </mesh>
      <Line points={outline} color="#39ff14" lineWidth={1.5} transparent opacity={0.85} />
    </group>
  );
}
