"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { AtlasAssets, Polyline } from "@/lib/atlas/assets";
import { inCentral, type Central } from "@/lib/atlas/central";
import { groundY, type HeightField } from "@/lib/atlas/geo";
import { runtime } from "@/lib/atlas/store";
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
      // Central Austin's terrain is finer, so follow it more closely there.
      const step = inCentral(ax, az) || inCentral(bx, bz) ? Math.min(maxStep, 0.02) : maxStep;
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
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
  /** lift above the ground (km) when zoomed out; it shrinks up close so lines hug the ground */
  yOff: number;
  /** fade out beyond this camera distance (km), for street-scale layers */
  maxDist?: number;
}

const STYLES: Record<string, LayerStyle> = {
  creeks: { day: "#7fb2c3", night: "#1d4660", width: 1, near: 0.55, far: 0.0, yOff: 0.004 },
  tertiary: { day: "#fffaf0", night: "#6f6b78", width: 1, near: 0.7, far: 0.0, yOff: 0.006 },
  secondary: { day: "#fffaf0", night: "#8b8290", width: 1.3, near: 0.85, far: 0.05, yOff: 0.007 },
  primary: { day: "#fffdf7", night: "#b2a18a", width: 1.8, near: 0.95, far: 0.25, yOff: 0.008 },
  trunk: { day: "#f4c58c", night: "#d8995a", width: 2.2, near: 1, far: 0.55, yOff: 0.009 },
  motorway: { day: "#e8a15c", night: "#f0a24e", width: 2.8, near: 1, far: 0.8, yOff: 0.01 },
  rail: { day: "#8c7d6a", night: "#5d5a6e", width: 1.1, near: 0.7, far: 0.1, yOff: 0.008 },
  // Central Austin at street scale.
  footway: { day: "#fbf6ea", night: "#58545f", width: 0.9, near: 0.8, far: 0, yOff: 0.004, maxDist: 2.2 },
  pedestrian: { day: "#fbf6ea", night: "#6a6470", width: 1.3, near: 0.85, far: 0, yOff: 0.004, maxDist: 2.6 },
  cycleway: { day: "#f2e2c2", night: "#6a6470", width: 1.1, near: 0.85, far: 0, yOff: 0.004, maxDist: 3 },
  path: { day: "#dcc9a2", night: "#55504f", width: 1, near: 0.8, far: 0, yOff: 0.004, maxDist: 2.4 },
  // The Ann & Roy Butler Hike-and-Bike Trail: crushed granite, the colour of the loop.
  butler: { day: "#cf9d6f", night: "#8a6a55", width: 2.2, near: 1, far: 0, yOff: 0.005, maxDist: 6 },
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
    const dist = runtime.cam.dist;
    m.opacity = style.near + (style.far - style.near) * z;
    if (style.maxDist) m.opacity *= 1 - THREE.MathUtils.smoothstep(dist, style.maxDist * 0.55, style.maxDist);
    l.visible = m.opacity > 0.02;
    // Lines are draped flat on the ground and lifted as a whole: well clear from altitude,
    // hugging the ground at street level.
    l.position.y = style.yOff * Math.min(1, Math.max(0.05, dist / 3));
    m.color.copy(day).lerp(night, sky.uNight.value);
    // Slightly thinner when far away so the network doesn't clot.
    m.linewidth = style.width * (1 - 0.35 * z);
  });

  return <primitive ref={ref} object={line} />;
}

export function MapLines({ assets, central, ground }: { assets: AtlasAssets; central?: Central; ground: HeightField }) {
  const layers = useMemo(() => {
    const v = assets.vectors;
    const h = ground;
    // Street-scale paths come with central Austin's detail.
    const paths = central?.paths ?? {};
    const butler = central ? central.trails.edges.filter((e) => e.kind === 0).map((e) => e.line) : [];
    const L: [string, Float32Array][] = [
      ["creeks", drape(v.creeks, h, 0, 0.2)],
      ["path", drape(paths.path ?? [], h, 0, 0.05)],
      ["footway", drape(paths.footway ?? [], h, 0, 0.05)],
      ["pedestrian", drape(paths.pedestrian ?? [], h, 0, 0.05)],
      ["cycleway", drape(paths.cycleway ?? [], h, 0, 0.05)],
      ["butler", drape(butler, h, 0, 0.05)],
      ["tertiary", drape(v.roads.tertiary, h, 0)],
      ["secondary", drape(v.roads.secondary, h, 0)],
      ["primary", drape(v.roads.primary, h, 0)],
      ["rail", drape(v.rail, h, 0)],
      ["trunk", drape(v.roads.trunk, h, 0)],
      ["motorway", drape(v.roads.motorway, h, 0)],
    ];
    return L;
  }, [assets, central, ground]);

  return (
    <group>
      {layers.map(([k, pos], i) => (
        <Layer key={k} positions={pos} style={STYLES[k]} order={i + 1} />
      ))}
    </group>
  );
}
