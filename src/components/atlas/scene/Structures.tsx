"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import earcut from "earcut";
import type { Polyline } from "@/lib/atlas/assets";
import type { Central } from "@/lib/atlas/central";
import { groundY, type HeightField } from "@/lib/atlas/geo";
import { runtime } from "@/lib/atlas/store";
import { sky } from "@/lib/atlas/timeOfDay";

// Things built over the water: bridge decks on their piers, the Boardwalk along the south
// shore, and the docks and piers the rowing and paddling clubs launch from.

const M = 0.001; // metres -> km

/** Deck widths (m) by road class. */
const DECK_WIDTH: Record<string, number> = {
  motorway: 34,
  trunk: 26,
  primary: 22,
  secondary: 18,
  tertiary: 14,
  residential: 11,
  unclassified: 11,
  cycleway: 5,
  footway: 5,
  pedestrian: 6,
  path: 4,
};

interface Builder {
  pos: number[];
  col: number[];
}

function tri(b: Builder, a: number[], c: number[], d: number[], color: THREE.Color) {
  b.pos.push(...a, ...c, ...d);
  for (let i = 0; i < 3; i++) b.col.push(color.r, color.g, color.b);
}

function quad(b: Builder, a: number[], c: number[], d: number[], e: number[], color: THREE.Color) {
  tri(b, a, c, d, color);
  tri(b, a, d, e, color);
}

/**
 * A deck along a polyline: top surface at y(t), sides down by `thick`. Returns the deck top
 * points (for placing piers).
 */
function deck(b: Builder, line: Polyline, halfW: number, yAt: (i: number, t: number) => number, thick: number, top: THREE.Color, side: THREE.Color) {
  const n = line.length / 2;
  const L: number[][] = [];
  const R: number[][] = [];
  let total = 0;
  const cum = [0];
  for (let i = 1; i < n; i++) {
    total += Math.hypot(line[i * 2] - line[i * 2 - 2], line[i * 2 + 1] - line[i * 2 - 1]);
    cum.push(total);
  }
  for (let i = 0; i < n; i++) {
    const j0 = Math.max(0, i - 1);
    const j1 = Math.min(n - 1, i + 1);
    let tx = line[j1 * 2] - line[j0 * 2];
    let tz = line[j1 * 2 + 1] - line[j0 * 2 + 1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const y = yAt(i, total > 0 ? cum[i] / total : 0);
    L.push([line[i * 2] - tz * halfW, y, line[i * 2 + 1] + tx * halfW]);
    R.push([line[i * 2] + tz * halfW, y, line[i * 2 + 1] - tx * halfW]);
  }
  for (let i = 0; i + 1 < n; i++) {
    const a = L[i];
    const c = L[i + 1];
    const d = R[i + 1];
    const e = R[i];
    quad(b, a, c, d, e, top);
    const down = (p: number[]) => [p[0], p[1] - thick, p[2]];
    quad(b, a, down(a), down(c), c, side);
    quad(b, e, d, down(d), down(e), side);
  }
  return { L, R, cum, total };
}

function column(b: Builder, x: number, z: number, yTop: number, yBottom: number, w: number, d: number, dirX: number, dirZ: number, color: THREE.Color) {
  // A pier under a deck, long across the flow.
  const ax = dirX * d;
  const az = dirZ * d;
  const bx = -dirZ * w;
  const bz = dirX * w;
  const corners = [
    [x - ax - bx, z - az - bz],
    [x + ax - bx, z + az - bz],
    [x + ax + bx, z + az + bz],
    [x - ax + bx, z - az + bz],
  ];
  for (let k = 0; k < 4; k++) {
    const p = corners[k];
    const q = corners[(k + 1) % 4];
    quad(b, [p[0], yTop, p[1]], [p[0], yBottom, p[1]], [q[0], yBottom, q[1]], [q[0], yTop, q[1]], color);
  }
}

function build(c: Central, ground: HeightField): THREE.BufferGeometry {
  const b: Builder = { pos: [], col: [] };
  const concrete = new THREE.Color("#dcd6cb");
  const concreteSide = new THREE.Color("#b5ada1");
  const wood = new THREE.Color("#b69a78");
  const woodSide = new THREE.Color("#8f765b");
  const pier = new THREE.Color("#c7bfb2");

  // Bridge decks: level from abutment to abutment with a gentle rise, on piers every ~50 m.
  for (const br of c.bridges) {
    const line = br.line;
    const n = line.length / 2;
    if (n < 2) continue;
    const halfW = ((DECK_WIDTH[br.cls] ?? 12) / 2) * M;
    const y0 = groundY(ground, line[0], line[1]);
    const y1 = groundY(ground, line[n * 2 - 2], line[n * 2 - 1]);
    const water = Math.min(y0, y1);
    const span = Math.hypot(line[n * 2 - 2] - line[0], line[n * 2 - 1] - line[1]);
    const rise = Math.min(0.004, span * 0.012);
    const yAt = (_i: number, t: number) => Math.max(y0 + (y1 - y0) * t + rise * Math.sin(Math.PI * t), water + 0.006);
    const { cum, total } = deck(b, line, halfW, yAt, 1.6 * M, concrete, concreteSide);
    const piers = Math.floor(total / 0.05);
    for (let k = 1; k <= piers; k++) {
      const s = (k / (piers + 1)) * total;
      let i = 0;
      while (i < n - 2 && cum[i + 1] < s) i++;
      const f = (s - cum[i]) / (cum[i + 1] - cum[i] || 1);
      const x = line[i * 2] + (line[i * 2 + 2] - line[i * 2]) * f;
      const z = line[i * 2 + 1] + (line[i * 2 + 3] - line[i * 2 + 1]) * f;
      const tx = line[i * 2 + 2] - line[i * 2];
      const tz = line[i * 2 + 3] - line[i * 2 + 1];
      const tl = Math.hypot(tx, tz) || 1;
      const yTop = yAt(i, s / total) - 1.6 * M;
      const yBot = groundY(ground, x, z) - 0.002;
      if (yTop > yBot) column(b, x, z, yTop, yBot, halfW * 0.8, 1.4 * M, tx / tl, tz / tl, pier);
    }
  }

  // The Boardwalk and the trail's other bridges: a wooden deck a metre or so above the water.
  for (const e of c.trails.edges) {
    if (e.kind !== 1) continue;
    const line = e.line;
    const n = line.length / 2;
    const ys = Array.from({ length: n }, (_, i) => groundY(ground, line[i * 2], line[i * 2 + 1]));
    const ya = ys[0];
    const yb = ys[n - 1];
    const yAt = (i: number, t: number) => Math.max(ya + (yb - ya) * t, ys[i] + 0.0012) + 0.0003;
    deck(b, line, 2.2 * M, yAt, 0.9 * M, wood, woodSide);
  }

  // Docks and piers: flat decks just above the water.
  for (const poly of c.piers.polys) {
    const n = poly.length / 2 - 1; // closed ring
    if (n < 3) continue;
    let y = Infinity;
    for (let i = 0; i < n; i++) y = Math.min(y, groundY(ground, poly[i * 2], poly[i * 2 + 1]));
    y += 0.0008;
    const flat: number[] = [];
    for (let i = 0; i < n; i++) flat.push(poly[i * 2], poly[i * 2 + 1]);
    const idx = earcut(flat);
    for (let k = 0; k < idx.length; k += 3) {
      const p = (j: number) => [flat[idx[k + j] * 2], y, flat[idx[k + j] * 2 + 1]];
      tri(b, p(0), p(2), p(1), wood);
    }
    for (let i = 0; i < n; i++) {
      const a = [flat[i * 2], y, flat[i * 2 + 1]];
      const d = [flat[((i + 1) % n) * 2], y, flat[((i + 1) % n) * 2 + 1]];
      quad(b, a, [a[0], y - 0.0007, a[2]], [d[0], y - 0.0007, d[2]], d, woodSide);
    }
  }
  for (const line of c.piers.lines) {
    const n = line.length / 2;
    let y = Infinity;
    for (let i = 0; i < n; i++) y = Math.min(y, groundY(ground, line[i * 2], line[i * 2 + 1]));
    deck(b, line, 1.1 * M, () => y + 0.0007, 0.6 * M, wood, woodSide);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export default function Structures({ central, ground }: { central: Central; ground: HeightField }) {
  const ref = useRef<THREE.Mesh>(null);
  const { geometry, material } = useMemo(
    () => ({
      geometry: build(central, ground),
      material: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    }),
    [central, ground],
  );
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    // Only worth drawing within a few kilometres; the structures are metres across.
    m.visible = runtime.cam.dist < 9;
    (m.material as THREE.MeshLambertMaterial).emissive.setRGB(0.12, 0.1, 0.08).multiplyScalar(sky.uNight.value);
  });
  return <mesh ref={ref} geometry={geometry} material={material} />;
}
