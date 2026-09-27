"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { AtlasAssets, Polyline } from "@/lib/atlas/assets";
import { groundY, type HeightField } from "@/lib/atlas/geo";
import { sky } from "@/lib/atlas/timeOfDay";

/** Segment pairs draped on the terrain, subdividing long spans so lines don't cut through hills. */
export function drape(lines: Polyline[], height: HeightField, yOff: number, maxStep = 0.12): Float32Array {
  const out: number[] = [];
  for (const l of lines) {
    for (let i = 0; i + 3 < l.length; i += 2) {
      const ax = l[i];
      const az = l[i + 1];
      const bx = l[i + 2];
      const bz = l[i + 3];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / maxStep));
      let px = ax;
      let pz = az;
      let py = groundY(height, ax, az) + yOff;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        const y = groundY(height, x, z) + yOff;
        out.push(px, py, pz, x, y, z);
        px = x;
        py = y;
        pz = z;
      }
    }
  }
  return new Float32Array(out);
}

interface LayerStyle {
  day: string;
  night: string;
  width: number;
  /** opacity when zoomed in / zoomed all the way out */
  near: number;
  far: number;
  yOff: number;
}

const STYLES: Record<string, LayerStyle> = {
  creeks: { day: "#7fb2c3", night: "#1d4660", width: 1, near: 0.55, far: 0.0, yOff: 0.004 },
  tertiary: { day: "#fffaf0", night: "#6f6b78", width: 1, near: 0.7, far: 0.0, yOff: 0.006 },
  secondary: { day: "#fffaf0", night: "#8b8290", width: 1.3, near: 0.85, far: 0.05, yOff: 0.007 },
  primary: { day: "#fffdf7", night: "#b2a18a", width: 1.8, near: 0.95, far: 0.25, yOff: 0.008 },
  trunk: { day: "#f4c58c", night: "#d8995a", width: 2.2, near: 1, far: 0.55, yOff: 0.009 },
  motorway: { day: "#e8a15c", night: "#f0a24e", width: 2.8, near: 1, far: 0.8, yOff: 0.01 },
  rail: { day: "#8c7d6a", night: "#5d5a6e", width: 1.1, near: 0.7, far: 0.1, yOff: 0.008 },
};

function Layer({ positions, style, order }: { positions: Float32Array; style: LayerStyle; order: number }) {
  const ref = useRef<LineSegments2>(null);
  const { line, day, night } = useMemo(() => {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    const material = new LineMaterial({
      color: style.day,
      linewidth: style.width,
      transparent: true,
      opacity: style.near,
      depthWrite: false,
      fog: true,
    });
    const line = new LineSegments2(geometry, material);
    line.frustumCulled = false;
    line.renderOrder = order;
    return { line, day: new THREE.Color(style.day), night: new THREE.Color(style.night) };
  }, [positions, style, order]);

  useFrame(() => {
    const l = ref.current;
    if (!l) return;
    const m = l.material;
    const z = sky.uZoomOut.value;
    m.opacity = style.near + (style.far - style.near) * z;
    l.visible = m.opacity > 0.02;
    m.color.copy(day).lerp(night, sky.uNight.value);
    // Slightly thinner when far away so the network doesn't clot.
    m.linewidth = style.width * (1 - 0.35 * z);
  });

  return <primitive ref={ref} object={line} />;
}

export function MapLines({ assets, ground }: { assets: AtlasAssets; ground: HeightField }) {
  const layers = useMemo(() => {
    const v = assets.vectors;
    const h = ground;
    const L: [string, Float32Array][] = [
      ["creeks", drape(v.creeks, h, STYLES.creeks.yOff, 0.2)],
      ["tertiary", drape(v.roads.tertiary, h, STYLES.tertiary.yOff)],
      ["secondary", drape(v.roads.secondary, h, STYLES.secondary.yOff)],
      ["primary", drape(v.roads.primary, h, STYLES.primary.yOff)],
      ["rail", drape(v.rail, h, STYLES.rail.yOff)],
      ["trunk", drape(v.roads.trunk, h, STYLES.trunk.yOff)],
      ["motorway", drape(v.roads.motorway, h, STYLES.motorway.yOff)],
    ];
    return L;
  }, [assets, ground]);

  return (
    <group>
      {layers.map(([k, pos], i) => (
        <Layer key={k} positions={pos} style={STYLES[k]} order={i + 1} />
      ))}
    </group>
  );
}
