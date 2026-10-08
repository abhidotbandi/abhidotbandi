"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import earcut from "earcut";
import * as THREE from "three";
import type { Polyline } from "@/lib/atlas/assets";
import { sampleWaterKm, type Central, type Pease } from "@/lib/atlas/central";
import { groundY, type HeightField } from "@/lib/atlas/geo";
import { Path } from "@/lib/atlas/paths";
import { pointInPoly } from "@/lib/atlas/polygon";
import { runtime } from "@/lib/atlas/store";
import { SHIRTS, SKIN, box, figureScale, headGeo, inWindow, instanced, lyingGeo, merge, pick, standGeo } from "./figures";

// Pease Park along Shoal Creek (scripts/atlas/build_central.py's pease()), and Kingsbury
// Commons at its south end as rebuilt in 2021 (Ten Eyck Landscape Architects, with Clayton
// Korte and Mell Lawrence Architects):
// - the Treehouse, a 40 ft steel orb of twisted rebar, vines up its lower half and a cargo net
//   across its middle, reached by a bridge from the hillside;
// - the splash pad in its limestone ribbon wall, which winds on round the Great Lawn;
// - the all-abilities playground of timber and cargo nets, the basketball court, the limestone
//   seat terraces below the Tudor Cottage, the stone entrance at Parkway and Kingsbury Street,
//   and the Civilian Conservation Corps' concrete picnic tables;
// - the sand volleyball courts by Lamar.
// And the people: the Shoal Creek Trail's walkers (many with dogs), runners and cyclists;
// picnics, frisbees and dogs on the lawns; hammocks slung between trees; children in the
// playground and the splash pad; games of volleyball and basketball; people lying on the
// Treehouse's net.

const M = 0.001;
/** The orb, the bridge and the furniture, as trees are: a little taller than life. */
const UP = 1.3;

const HAMMOCKS = ["#2fa39b", "#f07a3a", "#c8352e", "#7b4fb8", "#8cc63f", "#1d4f8f", "#e8c34a", "#d9418c"];
const BLANKETS = ["#e8c34a", "#3fb7b0", "#f07a5a", "#f4f1ea", "#2f6fb0", "#c8352e", "#8cc63f", "#f2a0b5"];
const DOGS = ["#8a6a4a", "#2b2522", "#d8c7a8", "#b58a5a", "#f1e6d0", "#5b4636"];
const RUN = ["#f28c28", "#3fb7b0", "#e8c34a", "#c8352e", "#f4f1ea", "#7b4fb8", "#8cc63f"];
const KIDS = ["#e8c34a", "#f07a5a", "#3fb7b0", "#c8352e", "#8cc63f", "#2f6fb0", "#f2a0b5", "#7b4fb8"];

/** A ring without its closing duplicate vertex. */
function ring(poly: Polyline): Polyline {
  const n = poly.length / 2;
  return n > 1 && poly[0] === poly[n * 2 - 2] && poly[1] === poly[n * 2 - 1] ? poly.slice(0, n * 2 - 2) : poly;
}

/** A polygon's frame: its longest edge's direction (u), across it (v), the centre and extents. */
function frame(poly: Polyline) {
  const r = ring(poly);
  const n = r.length / 2;
  let best = 0;
  let ux = 1;
  let uz = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = r[j * 2] - r[i * 2];
    const dz = r[j * 2 + 1] - r[i * 2 + 1];
    const l = Math.hypot(dx, dz);
    if (l > best) [best, ux, uz] = [l, dx / l, dz / l];
  }
  let [a0, a1, b0, b1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const a = r[i * 2] * ux + r[i * 2 + 1] * uz;
    const b = -r[i * 2] * uz + r[i * 2 + 1] * ux;
    [a0, a1, b0, b1] = [Math.min(a0, a), Math.max(a1, a), Math.min(b0, b), Math.max(b1, b)];
  }
  const ca = (a0 + a1) / 2;
  const cb = (b0 + b1) / 2;
  return { ux, uz, cx: ca * ux - cb * uz, cz: ca * uz + cb * ux, len: a1 - a0, wid: b1 - b0, ring: r };
}

function bbox(r: Polyline) {
  let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < r.length; i += 2) [x0, z0, x1, z1] = [Math.min(x0, r[i]), Math.min(z0, r[i + 1]), Math.max(x1, r[i]), Math.max(z1, r[i + 1])];
  return { x0, z0, x1, z1 };
}

/** Distance (km) from (x, z) to the nearest vertex or edge of a set of lines. */
function lineDist(lines: Polyline[], x: number, z: number): number {
  let d = Infinity;
  for (const l of lines) {
    for (let i = 0; i + 3 < l.length; i += 2) {
      const ax = l[i];
      const az = l[i + 1];
      const ex = l[i + 2] - ax;
      const ez = l[i + 3] - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
      d = Math.min(d, Math.hypot(ax + ex * t - x, az + ez * t - z));
    }
  }
  return d;
}

/** Geometries merged with a colour each, into one with a color attribute. */
function painted(parts: [THREE.BufferGeometry, string][]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (const [g0, hex] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    if (!g.attributes.normal) g.computeVertexNormals();
    c.set(hex);
    const p = g.attributes.position.array as ArrayLike<number>;
    const q = g.attributes.normal.array as ArrayLike<number>;
    for (let i = 0; i < p.length; i += 3) {
      pos.push(p[i], p[i + 1], p[i + 2]);
      nrm.push(q[i], q[i + 1], q[i + 2]);
      col.push(c.r, c.g, c.b);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return out;
}

/** A box in metres placed at world (x, y, z), turned to `yaw` (radians, from +x toward -z). */
function placed(w: number, h: number, d: number, x: number, y: number, z: number, yaw = 0, k = UP): THREE.BufferGeometry {
  const g = box(w, h, d, 0, h / 2, 0);
  g.scale(M, M * k, M);
  g.rotateY(yaw);
  g.translate(x, y, z);
  return g;
}

/** A strut (cylinder) between two world points, `r` metres thick. */
function strut(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r * M, r * M, d.length(), 4, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** A ground-hugging fill of a polygon, `lift` metres up. */
function fill(poly: Polyline, ground: HeightField, lift: number): THREE.BufferGeometry {
  const r = ring(poly);
  const tris = earcut(Array.from(r));
  const pos: number[] = [];
  const put = (t: number) => pos.push(r[t * 2], groundY(ground, r[t * 2], r[t * 2 + 1]) + lift * M, r[t * 2 + 1]);
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
    // Wound to face up whichever way the ring runs.
    const up = (r[b * 2 + 1] - r[a * 2 + 1]) * (r[c * 2] - r[a * 2]) - (r[b * 2] - r[a * 2]) * (r[c * 2 + 1] - r[a * 2 + 1]) > 0;
    put(a);
    put(up ? b : c);
    put(up ? c : b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

/** A disc on the ground at (x, z), `r` metres across, `lift` metres up. */
function disc(x: number, z: number, r: number, ground: HeightField, lift: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r * M, 28);
  g.rotateX(-Math.PI / 2);
  g.translate(x, groundY(ground, x, z) + lift * M, z);
  g.deleteAttribute("uv");
  return g;
}

interface Furniture {
  /** the orb's centre (world) and radius (km), for the people on its net */
  orb: THREE.Vector3;
  orbR: number;
  /** picnic tables: x, z, yaw */
  tables: [number, number, number][];
}

/** Kingsbury Commons' and the courts' fixed pieces, as one mesh in vertex colours. */
function furniture(p: Pease, ground: HeightField, rnd: () => number): { mesh: THREE.Mesh; info: Furniture } {
  const parts: [THREE.BufferGeometry, string][] = [];
  const gy = (x: number, z: number) => groundY(ground, x, z);
  const LIME = "#dcd0b5"; // limestone
  const lawn = p.lawns[0] ? ring(p.lawns[0]) : null;
  const trails = p.trail.edges.map((e) => e.line);

  // Courts: the basketball court in green with its lines and hoops; sand for volleyball, nets
  // across the middle; wood chips under the playground's timber towers and cargo nets.
  for (const c of p.courts.basketball) {
    const f = frame(c);
    parts.push([fill(c, ground, 0.12), "#3f735f"]);
    const yaw = -Math.atan2(f.uz, f.ux);
    const y = gy(f.cx, f.cz) + 0.15 * M;
    const L = f.len / M - 3;
    const Wd = f.wid / M - 3;
    const line = (w: number, d: number, a: number, b: number) =>
      parts.push([placed(w, 0.02, d, f.cx + (a * f.ux - b * f.uz) * M, y, f.cz + (a * f.uz + b * f.ux) * M, yaw, 1), "#f2f0e8"]);
    line(L, 0.3, 0, Wd / 2);
    line(L, 0.3, 0, -Wd / 2);
    line(0.3, Wd, L / 2, 0);
    line(0.3, Wd, -L / 2, 0);
    line(0.3, Wd, 0, 0);
    for (const end of [-1, 1]) {
      const a = end * (L / 2 - 2.9);
      parts.push([placed(5.8, 0.02, 4.9, f.cx + a * f.ux * M, y, f.cz + a * f.uz * M, yaw, 1), "#356452"]);
      const pa = end * (L / 2 + 0.6);
      parts.push([placed(0.18, 3.6, 0.18, f.cx + pa * f.ux * M, gy(f.cx, f.cz), f.cz + pa * f.uz * M, yaw), "#4a4d52"]);
      const ba = end * (L / 2 - 0.6);
      parts.push([placed(0.1, 1.05, 1.8, f.cx + ba * f.ux * M, gy(f.cx, f.cz) + 2.9 * M * UP, f.cz + ba * f.uz * M, yaw), "#f4f4f2"]);
      parts.push([placed(0.95, 0.06, 0.95, f.cx + (ba - end * 0.5) * f.ux * M, gy(f.cx, f.cz) + 3.05 * M * UP, f.cz + (ba - end * 0.5) * f.uz * M, yaw), "#e2622b"]);
    }
  }
  for (const c of p.courts.volleyball) {
    const f = frame(c);
    parts.push([fill(c, ground, 0.1), "#dcc79e"]);
    // The net across the court's middle (a box long in z, turned to lie across), its posts
    // outside the sidelines.
    const yaw = -Math.atan2(f.uz, f.ux);
    const half = f.wid / M / 2 + 0.6;
    const y = gy(f.cx, f.cz);
    for (const s of [-1, 1]) {
      parts.push([placed(0.12, 2.55, 0.12, f.cx - s * half * f.uz * M, y, f.cz + s * half * f.ux * M, yaw), "#55575c"]);
    }
    parts.push([placed(0.05, 1.0, half * 2, f.cx, y + 1.43 * M * UP, f.cz, yaw), "#2d2f33"]);
    parts.push([placed(0.06, 0.08, half * 2, f.cx, y + 2.43 * M * UP, f.cz, yaw), "#f4f4f2"]);
  }
  for (const c of p.courts.playground) {
    const f = frame(c);
    parts.push([fill(c, ground, 0.1), "#a07a52"]);
    const r = ring(c);
    // Three timber towers joined by cargo-net ramps, and a slide off the tallest.
    const spots: [number, number][] = [];
    for (let t = 0; spots.length < 3 && t < 200; t++) {
      const a = (rnd() - 0.5) * f.len * 0.7;
      const b = (rnd() - 0.5) * f.wid * 0.7;
      const x = f.cx + a * f.ux - b * f.uz;
      const z = f.cz + a * f.uz + b * f.ux;
      if (pointInPoly(r, x, z) && spots.every(([sx, sz]) => Math.hypot(sx - x, sz - z) > 0.006)) spots.push([x, z]);
    }
    const yaw = -Math.atan2(f.uz, f.ux);
    spots.forEach(([x, z], i) => {
      const y = gy(x, z);
      const top = 1.6 + i * 0.5;
      for (const [dx, dz] of [
        [-1.1, -1.1],
        [1.1, -1.1],
        [1.1, 1.1],
        [-1.1, 1.1],
      ]) {
        const px = x + (dx * f.ux - dz * f.uz) * M;
        const pz = z + (dx * f.uz + dz * f.ux) * M;
        parts.push([placed(0.22, top + 1.4, 0.22, px, y, pz, yaw), "#b98d5e"]);
      }
      parts.push([placed(2.5, 0.15, 2.5, x, y + top * M * UP, z, yaw), "#c49a68"]);
      parts.push([placed(2.7, 0.18, 0.18, x, y + (top + 1.35) * M * UP, z, yaw), "#b98d5e"]);
      if (i === spots.length - 1) {
        // A slide off the tallest, down to the chips.
        const a = new THREE.Vector3(x + 1.3 * f.ux * M, y + top * M * UP, z + 1.3 * f.uz * M);
        const b = new THREE.Vector3(x + 4.6 * f.ux * M, gy(x + 4.6 * f.ux * M, z + 4.6 * f.uz * M) + 0.3 * M, z + 4.6 * f.uz * M);
        parts.push([strut(a, b, 0.35), "#d8d2c4"]);
      }
    });
    for (let i = 0; i + 1 < spots.length; i++) {
      const [ax, az] = spots[i];
      const [bx, bz] = spots[i + 1];
      const a = new THREE.Vector3(ax, gy(ax, az) + (1.6 + i * 0.5) * M * UP, az);
      const b = new THREE.Vector3(bx, gy(bx, bz) + (1.6 + (i + 1) * 0.5) * M * UP, bz);
      // A cargo net between the towers: a sagging web of rope.
      for (let k = -2; k <= 2; k++) {
        const off = new THREE.Vector3(-(bz - az), 0, bx - ax).normalize().multiplyScalar(k * 0.4 * M);
        const mid = a.clone().add(b).multiplyScalar(0.5).add(off);
        mid.y -= 0.6 * M * UP;
        parts.push([strut(a.clone().add(off), mid, 0.05), "#3b3a36"]);
        parts.push([strut(mid, b.clone().add(off), 0.05), "#3b3a36"]);
      }
    }
  }

  // The splash pad, in its ribbon of limestone seat wall.
  const [sx, sz] = p.spots.splash;
  parts.push([disc(sx, sz, 8.5, ground, 0.1), "#c9cfce"]);
  parts.push([disc(sx, sz, 5.5, ground, 0.13), "#9fb7c0"]);
  for (let i = 0; i < 14; i++) {
    const a = Math.PI * 0.55 + (i / 13) * Math.PI * 1.1;
    const x = sx + Math.cos(a) * 9.4 * M;
    const z = sz + Math.sin(a) * 9.4 * M;
    parts.push([placed(2.3, 0.5, 0.55, x, gy(x, z), z, -a + Math.PI / 2), LIME]);
  }
  // The ribbon wall winds on round the Great Lawn, with gaps where the paths come through.
  if (lawn) {
    const n = lawn.length / 2;
    let piece = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = lawn[i * 2];
      const az = lawn[i * 2 + 1];
      const bx = lawn[j * 2];
      const bz = lawn[j * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      const k = Math.max(1, Math.round(L / (3.5 * M)));
      for (let s = 0; s < k; s++) {
        piece++;
        const t = (s + 0.5) / k;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        if (piece % 9 === 0 || lineDist(trails, x, z) < 2.5 * M) continue;
        parts.push([placed((L / k / M) * 1.02, 0.5, 0.5, x, gy(x, z), z, -Math.atan2(bz - az, bx - ax)), LIME]);
      }
    }
  }

  // The seat terraces stepping down north from the Tudor Cottage toward the lawn.
  const [cx, cz] = p.spots.cottage;
  for (let row = 0; row < 3; row++) {
    const rad = 7 + row * 2.2;
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.24; // facing north (scene -z)
      const x = cx + Math.cos(a) * rad * M;
      const z = cz - 0.004 + Math.sin(a) * rad * M;
      parts.push([placed(1.9, 0.45, 0.6, x, gy(x, z), z, -a + Math.PI / 2), LIME]);
    }
  }

  // The entrance at Parkway and Kingsbury Street: a limestone wall with "Pease Park" carved in
  // it, facing the street between two big live oaks (in the tree data). The carving reads as a
  // deeper band on both faces.
  const [ax, az] = p.spots.entry;
  const lc = lawn ? frame(lawn) : null;
  const across = (lc ? Math.atan2(lc.cz - az, lc.cx - ax) : 0) + Math.PI / 2;
  const ay = gy(ax, az);
  parts.push([placed(9, 1.3, 0.8, ax, ay, az, -across), LIME]);
  parts.push([placed(9.3, 0.12, 0.95, ax, ay + 1.3 * M * UP, az, -across), "#cfc2a4"]);
  parts.push([placed(5.2, 0.3, 0.84, ax, ay + 0.6 * M * UP, az, -across), "#9b917f"]);

  // The Treehouse: a two-level orb of twisted rebar on the hillside, vines up its lower half, a
  // cargo net across its middle, its walkway round it at net height and the bridge from the hill.
  const [tx, tz] = p.spots.treescape;
  const R = 6.1;
  const base = gy(tx, tz);
  const orb = new THREE.Vector3(tx, base + R * M * UP, tz);
  const ico = new THREE.IcosahedronGeometry(1, 1);
  const pos = ico.attributes.position;
  const seen = new Set<string>();
  for (let i = 0; i < pos.count; i += 3) {
    for (const [u, v] of [
      [i, i + 1],
      [i + 1, i + 2],
      [i + 2, i],
    ]) {
      const pa = new THREE.Vector3().fromBufferAttribute(pos, u);
      const pb = new THREE.Vector3().fromBufferAttribute(pos, v);
      const key = [pa, pb]
        .map((q) => `${q.x.toFixed(3)},${q.y.toFixed(3)},${q.z.toFixed(3)}`)
        .sort()
        .join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      if (pa.y < -0.92 && pb.y < -0.92) continue; // (it stands in the ground at its foot)
      const w = (q: THREE.Vector3) => new THREE.Vector3(tx + q.x * R * M * UP, orb.y + q.y * R * M * UP, tz + q.z * R * M * UP);
      const low = (pa.y + pb.y) / 2 < -0.15 && rnd() < 0.7;
      parts.push([strut(w(pa), w(pb), 0.16), low ? "#5b7d3e" : "#6e4d38"]);
    }
  }
  const net = new THREE.CircleGeometry((R - 0.3) * M * UP, 24);
  net.rotateX(-Math.PI / 2);
  net.translate(tx, orb.y, tz);
  net.deleteAttribute("uv");
  parts.push([net, "#3e3730"]);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = tx + Math.cos(a) * (R + 0.9) * M * UP;
    const z = tz + Math.sin(a) * (R + 0.9) * M * UP;
    parts.push([placed(3.4, 0.12, 1.4, x, orb.y - 0.12 * M, z, -a + Math.PI / 2, 1), "#7a6656"]);
    parts.push([placed(0.08, 1.05, 3.2, x + Math.cos(a) * 0.7 * M, orb.y, z + Math.sin(a) * 0.7 * M, -a, UP), "#6b5b4d"]);
  }
  // The ledgestone seat wall round its foot.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const x = tx + Math.cos(a) * (R + 2.2) * M * UP;
    const z = tz + Math.sin(a) * (R + 2.2) * M * UP;
    parts.push([placed(2.4, 0.45, 0.6, x, gy(x, z), z, -a + Math.PI / 2), LIME]);
  }
  // The bridge from the hillside: the longest straight run Overture maps there.
  const run = p.bridge.reduce<Polyline | null>((b, l) => (l.length === 4 && (!b || l.length > b.length) ? l : b), null);
  if (run) {
    const [x0, z0, x1, z1] = [run[0], run[1], run[2], run[3]];
    const far = Math.hypot(x0 - tx, z0 - tz) > Math.hypot(x1 - tx, z1 - tz) ? [x0, z0] : [x1, z1];
    const a = new THREE.Vector3(far[0], Math.max(gy(far[0], far[1]) + 0.3 * M, orb.y - 2 * M), far[1]);
    const b = new THREE.Vector3(tx + ((far[0] - tx) / Math.hypot(far[0] - tx, far[1] - tz)) * (R + 1.5) * M * UP, orb.y - 0.1 * M, tz + ((far[1] - tz) / Math.hypot(far[0] - tx, far[1] - tz)) * (R + 1.5) * M * UP);
    const d = b.clone().sub(a);
    const yaw = -Math.atan2(d.z, d.x);
    const L = Math.hypot(d.x, d.z) / M;
    const g = box(L, 0.18, 1.9, 0, 0, 0);
    g.scale(M, M, M);
    g.rotateZ(Math.atan2(d.y, Math.hypot(d.x, d.z)));
    g.rotateY(yaw);
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    parts.push([g, "#7a6656"]);
    for (const s of [-1, 1]) {
      const off = new THREE.Vector3(-Math.sin(-yaw), 0, Math.cos(-yaw)).multiplyScalar(0.95 * s * M);
      const rail = new THREE.Vector3(0, 1.05 * M * UP, 0);
      parts.push([strut(a.clone().add(off).add(rail), b.clone().add(off).add(rail), 0.05), "#5a4b3f"]);
    }
    for (let k = 0; k <= 3; k++) {
      const q = a.clone().lerp(b, k / 3);
      const h = q.y - gy(q.x, q.z);
      if (h > 0.5 * M) parts.push([strut(new THREE.Vector3(q.x, gy(q.x, q.z), q.z), q, 0.14), "#6b5b4d"]);
    }
  }

  // The CCC's concrete picnic tables, under the trees round the lawn.
  const tables: [number, number, number][] = [];
  if (lawn && lc) {
    const n = lawn.length / 2;
    for (let t = 0; tables.length < 16 && t < 600; t++) {
      const i = Math.floor(rnd() * n);
      const j = (i + 1) % n;
      const f = rnd();
      const ex = lawn[j * 2] - lawn[i * 2];
      const ez = lawn[j * 2 + 1] - lawn[i * 2 + 1];
      const el = Math.hypot(ex, ez) || 1;
      // Outward from the edge (the side away from the lawn's centre).
      let nx = -ez / el;
      let nz = ex / el;
      const mx = lawn[i * 2] + ex * f;
      const mz = lawn[i * 2 + 1] + ez * f;
      if ((mx - lc.cx) * nx + (mz - lc.cz) * nz < 0) [nx, nz] = [-nx, -nz];
      const off = (5 + rnd() * 9) * M;
      const x = mx + nx * off;
      const z = mz + nz * off;
      if (pointInPoly(lawn, x, z) || lineDist(trails, x, z) < 3 * M) continue;
      if (tables.some(([qx, qz]) => Math.hypot(qx - x, qz - z) < 9 * M)) continue;
      if (Math.hypot(x - sx, z - sz) < 13 * M) continue;
      tables.push([x, z, -Math.atan2(ez, ex)]);
    }
  }
  for (const [x, z, yaw] of tables) {
    const y = gy(x, z);
    parts.push([placed(3.6, 0.12, 0.95, x, y + 0.66 * M * UP, z, yaw), "#bdb8ad"]);
    for (const s of [-1, 1]) {
      const bx = x + -Math.sin(-yaw) * 0.85 * s * M;
      const bz = z + Math.cos(-yaw) * 0.85 * s * M;
      parts.push([placed(3.6, 0.1, 0.36, bx, y + 0.38 * M * UP, bz, yaw), "#b3aea3"]);
    }
    for (const s of [-1, 1]) {
      const lx = x + Math.cos(-yaw) * 1.4 * s * M;
      const lz = z + Math.sin(-yaw) * 1.4 * s * M;
      parts.push([placed(0.3, 0.66, 2.0, lx, y, lz, yaw), "#a9a499"]);
    }
  }

  const geo = painted(parts);
  geo.computeBoundingSphere();
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  return { mesh, info: { orb, orbR: R * M * UP, tables } };
}

// ---------------------------------------------------------------- people

interface Edge {
  path: Path;
  a: number;
  b: number;
}
interface Walker {
  kind: "walk" | "run" | "bike";
  edge: number;
  dir: number;
  d: number;
  speed: number;
  window: [number, number];
  show: number;
  shirt: THREE.Color;
  skin: THREE.Color;
  dog: THREE.Color | null;
  phase: number;
}
interface Roamer {
  x: number;
  z: number;
  hx: number;
  hz: number;
  speed: number;
  area: Polyline;
  /** children are drawn smaller */
  size: number;
  color: THREE.Color;
  skin: THREE.Color | null;
  phase: number;
}
interface Group {
  x: number;
  z: number;
  yaw: number;
  blanket: THREE.Color;
  people: { dx: number; dz: number; shirt: THREE.Color; skin: THREE.Color }[];
}
interface Pair {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  shirts: [THREE.Color, THREE.Color];
  skins: [THREE.Color, THREE.Color];
  phase: number;
}
interface Hammock {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  color: THREE.Color;
  shirt: THREE.Color;
  skin: THREE.Color;
}
interface Court {
  f: ReturnType<typeof frame>;
  players: { a: number; b: number; shirt: THREE.Color; skin: THREE.Color; phase: number }[];
  ball: THREE.Color;
  kind: "volley" | "hoops";
}
interface Sim {
  edges: Edge[];
  adj: number[][];
  walkers: Walker[];
  roamers: Roamer[];
  groups: Group[];
  pairs: Pair[];
  hammocks: Hammock[];
  courts: Court[];
  splash: { x: number; z: number };
  netters: { a: number; r: number; yaw: number; shirt: THREE.Color; skin: THREE.Color }[];
  info: Furniture;
  centre: [number, number];
  meshes: Record<"standing" | "heads" | "lying" | "seated" | "dogs" | "bikes" | "riders" | "flats" | "balls" | "jets" | "fabric", THREE.InstancedMesh>;
}

function makeSim(c: Central, p: Pease, ground: HeightField, lowPower: boolean): THREE.Group {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const col = (hex: string) => new THREE.Color(hex);
  const skin = () => pick(SKIN, rnd()).clone();
  const dense = lowPower ? 0.45 : 1;
  const count = (n: number) => Math.max(1, Math.round(n * dense));
  const { mesh: fixed, info } = furniture(p, ground, rnd);

  // The trail graph.
  const adj: number[][] = Array.from({ length: p.trail.nodes.length / 2 }, () => []);
  const edges: Edge[] = p.trail.edges.map((e, i) => {
    adj[e.a].push(i);
    adj[e.b].push(i);
    return { path: new Path(e.line), a: e.a, b: e.b };
  });
  const total = edges.reduce((s, e) => s + e.path.length, 0);
  const walkers: Walker[] = [];
  if (edges.length) {
    for (let i = 0; i < count(150); i++) {
      let r = rnd() * total;
      let k = 0;
      while (k < edges.length - 1 && r > edges[k].path.length) r -= edges[k++].path.length;
      const kind: Walker["kind"] = i % 6 === 0 ? "bike" : i % 6 < 3 ? "run" : "walk";
      const morning = rnd() < 0.55;
      walkers.push({
        kind,
        edge: k,
        dir: rnd() < 0.5 ? 1 : -1,
        d: rnd() * edges[k].path.length,
        speed: (kind === "walk" ? 1.3 : kind === "run" ? 3.0 : 5.0) * 2 * (0.85 + rnd() * 0.3) * M,
        window:
          kind === "walk"
            ? [0.1 + rnd() * 0.12, 0.8 + rnd() * 0.12]
            : kind === "run"
              ? morning
                ? [0.03 + rnd() * 0.07, 0.34 + rnd() * 0.16]
                : [0.52 + rnd() * 0.16, 0.88 + rnd() * 0.07]
              : [0.12 + rnd() * 0.1, 0.8 + rnd() * 0.1],
        show: 0,
        shirt: kind === "run" ? col(pick(RUN, rnd())) : col(pick(SHIRTS, rnd())),
        skin: skin(),
        // Pease is the dogs' park: most of its walkers bring one.
        dog: kind === "walk" && rnd() < 0.6 ? col(pick(DOGS, rnd())) : null,
        phase: rnd(),
      });
    }
  }

  // Somewhere on a polygon, clear of water.
  const inside = (poly: Polyline, edge = 0): [number, number] | null => {
    const b = bbox(poly);
    for (let t = 0; t < 60; t++) {
      const x = b.x0 + rnd() * (b.x1 - b.x0);
      const z = b.z0 + rnd() * (b.z1 - b.z0);
      if (!pointInPoly(poly, x, z) || sampleWaterKm(c, x, z) > -0.004) continue;
      if (edge > 0 && lineDist([poly], x, z) < edge) continue;
      return [x, z];
    }
    return null;
  };
  const roamers: Roamer[] = [];
  const roam = (area: Polyline, n: number, dogShare: number, kids = false) => {
    for (let i = 0; i < n; i++) {
      const q = inside(area);
      if (!q) continue;
      const a = rnd() * Math.PI * 2;
      const dog = rnd() < dogShare;
      roamers.push({
        x: q[0],
        z: q[1],
        hx: Math.cos(a),
        hz: Math.sin(a),
        speed: (dog ? 3.2 : kids ? 1.8 : 1.1) * (0.8 + rnd() * 0.4) * M,
        area,
        size: kids && !dog ? 0.62 + rnd() * 0.12 : 1,
        color: dog ? col(pick(DOGS, rnd())) : kids ? col(pick(KIDS, rnd())) : col(pick(SHIRTS, rnd())),
        skin: dog ? null : skin(),
        phase: rnd() * 10,
      });
    }
  };
  const [great, meadow] = [p.lawns[0] ? ring(p.lawns[0]) : null, p.lawns[1] ? ring(p.lawns[1]) : null];
  if (great) roam(great, count(18), 0.35);
  // Live Oak Meadow: dogs off the lead and their people.
  if (meadow) roam(meadow, count(26), 0.6);
  for (const pg of p.courts.playground) roam(ring(pg), count(18), 0, true);
  const [sx, sz] = p.spots.splash;
  const splashArea = new Float32Array(Array.from({ length: 16 }, (_, i) => [sx + Math.cos((i / 16) * Math.PI * 2) * 7 * M, sz + Math.sin((i / 16) * Math.PI * 2) * 7 * M]).flat());
  roam(splashArea, count(14), 0, true);

  // Picnics on blankets along the lawns' shady edges, frisbees across them.
  const groups: Group[] = [];
  const pairs: Pair[] = [];
  for (const [lawn, n, fr] of [
    [great, 12, 3],
    [meadow, 8, 2],
  ] as const) {
    if (!lawn) continue;
    for (let i = 0; i < count(n); i++) {
      // Picnics keep to the lawn's shady edges.
      const q = inside(lawn, 0);
      if (!q || lineDist([lawn], q[0], q[1]) > 14 * M) continue;
      const k = 1 + Math.floor(rnd() * 4);
      groups.push({
        x: q[0],
        z: q[1],
        yaw: rnd() * Math.PI,
        blanket: col(pick(BLANKETS, rnd())),
        people: Array.from({ length: k }, (_, j) => {
          const a = (j / k) * Math.PI * 2 + rnd() * 0.4;
          return { dx: Math.cos(a) * 0.8, dz: Math.sin(a) * 0.8, shirt: col(pick(SHIRTS, rnd())), skin: skin() };
        }),
      });
    }
    for (let i = 0; i < count(fr); i++) {
      const q = inside(lawn, 8 * M);
      if (!q) continue;
      const a = rnd() * Math.PI;
      const half = (6 + rnd() * 4) * M;
      pairs.push({
        ax: q[0] - Math.cos(a) * half,
        az: q[1] - Math.sin(a) * half,
        bx: q[0] + Math.cos(a) * half,
        bz: q[1] + Math.sin(a) * half,
        shirts: [col(pick(SHIRTS, rnd())), col(pick(SHIRTS, rnd()))],
        skins: [skin(), skin()],
        phase: rnd(),
      });
    }
  }

  // Hammocks between pairs of trees in the woods by the lawns and the trail.
  const hammocks: Hammock[] = [];
  const outline = p.outline.map(ring);
  const t = c.trees;
  const bb = outline.map(bbox).reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), z0: Math.min(a.z0, b.z0), x1: Math.max(a.x1, b.x1), z1: Math.max(a.z1, b.z1) }));
  const cand: number[] = [];
  for (let i = 0; i < t.count; i++) {
    if (t.x[i] < bb.x0 || t.x[i] > bb.x1 || t.z[i] < bb.z0 || t.z[i] > bb.z1) continue;
    if ((t.v[i] & 128) !== 0) continue; // not the junipers and cypress
    if (outline.some((o) => pointInPoly(o, t.x[i], t.z[i]))) cand.push(i);
  }
  const trailLines = p.trail.edges.map((e) => e.line);
  const lawnsOut = [great, meadow].filter((l): l is Polyline => !!l);
  // The candidates in 8 m cells, to find each one's neighbours.
  const cell = 8 * M;
  const cells = new Map<string, number[]>();
  const cellKey = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (const i of cand) {
    const k = cellKey(t.x[i], t.z[i]);
    const list = cells.get(k);
    if (list) list.push(i);
    else cells.set(k, [i]);
  }
  for (let k = 0; hammocks.length < count(30) && k < Math.min(4000, cand.length * 3); k++) {
    const i = cand[Math.floor(rnd() * cand.length)];
    const near = (q: number) => Math.hypot(t.x[q] - t.x[i], t.z[q] - t.z[i]);
    let j = -1;
    const gx = Math.floor(t.x[i] / cell);
    const gz = Math.floor(t.z[i] / cell);
    for (let dx = -1; dx <= 1 && j < 0; dx++) {
      for (let dz = -1; dz <= 1 && j < 0; dz++) {
        for (const q of cells.get(`${gx + dx},${gz + dz}`) ?? []) {
          const d = near(q);
          if (q !== i && d > 4 * M && d < 6.5 * M) {
            j = q;
            break;
          }
        }
      }
    }
    if (j < 0) continue;
    const mx = (t.x[i] + t.x[j]) / 2;
    const mz = (t.z[i] + t.z[j]) / 2;
    if (sampleWaterKm(c, mx, mz) > -0.003) continue;
    const toPeople = Math.min(lineDist(trailLines, mx, mz), ...lawnsOut.map((l) => lineDist([l], mx, mz)));
    if (toPeople > 30 * M || lineDist(trailLines, mx, mz) < 3 * M) continue;
    if (hammocks.some((h) => Math.hypot((h.ax + h.bx) / 2 - mx, (h.az + h.bz) / 2 - mz) < 16 * M)) continue;
    // Slung from the trunks, a metre or so inside each crown's edge.
    const ux = (t.x[j] - t.x[i]) / near(j);
    const uz = (t.z[j] - t.z[i]) / near(j);
    hammocks.push({
      ax: t.x[i] + ux * 0.4 * M,
      az: t.z[i] + uz * 0.4 * M,
      bx: t.x[j] - ux * 0.4 * M,
      bz: t.z[j] - uz * 0.4 * M,
      color: col(pick(HAMMOCKS, rnd())),
      shirt: col(pick(SHIRTS, rnd())),
      skin: skin(),
    });
  }

  // Games: volleyball on the sand by Lamar, basketball on the court.
  const courts: Court[] = [];
  p.courts.volleyball.forEach((v, i) => {
    const f = frame(v);
    const n = i === 2 ? 2 : 4;
    courts.push({
      f,
      kind: "volley",
      ball: col("#f4f1ea"),
      players: Array.from({ length: n }, (_, k) => ({
        a: (k % 2 === 0 ? -1 : 1) * (0.25 + rnd() * 0.2),
        b: (Math.floor(k / 2) === 0 ? -1 : 1) * (0.15 + rnd() * 0.15) * (n === 2 ? 0 : 1),
        shirt: col(pick(SHIRTS, rnd())),
        skin: skin(),
        phase: rnd() * 10,
      })),
    });
  });
  for (const b of p.courts.basketball) {
    courts.push({
      f: frame(b),
      kind: "hoops",
      ball: col("#d8692e"),
      players: Array.from({ length: 6 }, () => ({
        a: rnd() - 0.5,
        b: rnd() - 0.5,
        shirt: col(pick(SHIRTS, rnd())),
        skin: skin(),
        phase: rnd() * 10,
      })),
    });
  }
  // On the Treehouse's net, and round its walkway.
  const netters = Array.from({ length: 6 }, (_, k) => ({
    a: rnd() * Math.PI * 2,
    r: k < 4 ? 0.25 + rnd() * 0.55 : 1.15,
    yaw: rnd() * Math.PI * 2,
    shirt: col(pick(SHIRTS, rnd())),
    skin: skin(),
  }));

  const mat = new THREE.MeshLambertMaterial({ color: "#ffffff" });
  const jetMat = new THREE.MeshLambertMaterial({ color: "#ffffff", transparent: true, opacity: 0.55, emissive: "#2a3a44" });
  const sitGeo = merge([box(0.42, 0.55, 0.26, 0, 0.36, 0), box(0.34, 0.14, 0.55, 0, 0.07, 0.3)]);
  const dogGeo = merge([box(0.28, 0.3, 0.75, 0, 0.35, 0), box(0.22, 0.24, 0.26, 0, 0.55, 0.42), box(0.06, 0.06, 0.3, 0, 0.5, -0.45)]);
  const bikeGeo = merge([box(0.05, 0.66, 0.66, 0, 0.33, 0.52), box(0.05, 0.66, 0.66, 0, 0.33, -0.52), box(0.06, 0.06, 1.0, 0, 0.62, 0)]);
  const riderGeo = merge([box(0.4, 0.55, 0.24, 0, 0.3, 0), box(0.28, 0.5, 0.2, 0, -0.2, 0.12)]);
  const nPeople = walkers.length + roamers.length + groups.length * 4 + pairs.length * 2 + hammocks.length + courts.length * 6 + 12;
  const meshes: Sim["meshes"] = {
    standing: instanced(standGeo(), mat, nPeople),
    heads: instanced(headGeo(), mat, nPeople * 2),
    lying: instanced(lyingGeo(), mat, hammocks.length + 12),
    seated: instanced(sitGeo, mat, groups.length * 4 + 4),
    dogs: instanced(dogGeo, mat, walkers.length + roamers.length),
    bikes: instanced(bikeGeo, mat, walkers.length),
    riders: instanced(riderGeo, mat, walkers.length),
    flats: instanced(box(1, 1, 1, 0, 0.5, 0), mat, groups.length + 2),
    balls: instanced(new THREE.IcosahedronGeometry(0.12, 1), mat, courts.length + pairs.length + 4),
    jets: instanced(new THREE.CylinderGeometry(0.05, 0.12, 1, 6, 1, true).translate(0, 0.5, 0), jetMat, 18),
    fabric: instanced(box(1, 1, 1, 0, 0, 0), mat, hammocks.length * 3 + 1),
  };
  const root = new THREE.Group();
  root.add(fixed, ...Object.values(meshes));
  const centre = p.spots.treescape;
  root.userData.sim = {
    edges,
    adj,
    walkers,
    roamers,
    groups,
    pairs,
    hammocks,
    courts,
    splash: { x: sx, z: sz },
    netters,
    info,
    centre,
    meshes,
  } satisfies Sim;
  return root;
}

const q = new THREE.Quaternion();
const e3 = new THREE.Euler();
const v3 = new THREE.Vector3();
const s3 = new THREE.Vector3();
const mOut = new THREE.Matrix4();
const probe = { x: 0, z: 0, dx: 0, dz: 0 };
const DARK = new THREE.Color("#2a2a2e");
const DISC = new THREE.Color("#f2c230");
const WATER = new THREE.Color("#dff3fb");

function at(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, rx = 0, rz = 0): THREE.Matrix4 {
  e3.set(rx, yaw, rz, "YXZ");
  q.setFromEuler(e3);
  return mOut.compose(v3.set(x, y, z), q, s3.set(sx, sy, sz));
}

export default function PeasePark({ central, ground, lowPower }: { central: Central; ground: HeightField; lowPower: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const root = useMemo(() => (central.pease ? makeSim(central, central.pease, ground, lowPower) : null), [central, ground, lowPower]);

  useFrame((state, rawDt) => {
    const g = ref.current;
    if (!g || !root) return;
    const sim = g.userData.sim as Sim;
    const cam = runtime.cam;
    const [cx, cz] = sim.centre;
    const near = cam.dist < 5 && Math.hypot(cam.x - cx, cam.z - cz) < 3 + cam.dist;
    g.visible = near;
    if (!near) return;
    const { meshes, edges, adj } = sim;
    const still = runtime.reducedMotion;
    const dt = still ? 0 : Math.min(rawDt, 0.1);
    const t = still ? 0 : state.clock.elapsedTime;
    const tod = runtime.tod;
    const E = Math.min(figureScale(cam.dist), 4);
    const s = E * M;
    const n: Record<keyof Sim["meshes"], number> = {
      standing: 0,
      heads: 0,
      lying: 0,
      seated: 0,
      dogs: 0,
      bikes: 0,
      riders: 0,
      flats: 0,
      balls: 0,
      jets: 0,
      fabric: 0,
    };
    const put = (key: keyof Sim["meshes"], m: THREE.Matrix4, c: THREE.Color) => {
      const mesh = meshes[key];
      const i = n[key]++;
      if (i >= mesh.instanceMatrix.count) return;
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c);
    };
    const gy = (x: number, z: number) => groundY(ground, x, z);
    const person = (x: number, y: number, z: number, yaw: number, k: number, shirt: THREE.Color, skinC: THREE.Color, bob = 0, lean = 0) => {
      put("standing", at(x, y + bob * k, z, yaw, k, k, k, lean), shirt);
      put("heads", at(x + Math.sin(yaw) * lean * 1.5 * k, y + (1.62 + bob) * k, z + Math.cos(yaw) * lean * 1.5 * k, yaw, k, k, k), skinC);
    };

    // The trail.
    const reach = Math.max(1.2, cam.dist * 2.4);
    for (const w of sim.walkers) {
      const want = inWindow(tod, w.window);
      w.show += (want - w.show) * (still ? 1 : 1 - Math.exp(-3 * Math.max(dt, 0.016)));
      if (w.show < 0.05) continue;
      let e = edges[w.edge];
      w.d += w.speed * dt;
      let guard = 0;
      while (w.d > e.path.length && guard++ < 4) {
        w.d -= e.path.length;
        const node = w.dir > 0 ? e.b : e.a;
        const options = adj[node].filter((k) => k !== w.edge);
        const next = options.length ? options[Math.floor(Math.random() * options.length)] : w.edge;
        w.edge = next;
        e = edges[next];
        w.dir = e.a === node ? 1 : -1;
      }
      const along = w.dir > 0 ? w.d : e.path.length - w.d;
      e.path.at(along, probe);
      if (Math.abs(probe.x - cam.x) > reach || Math.abs(probe.z - cam.z) > reach) continue;
      const hx = probe.dx * w.dir;
      const hz = probe.dz * w.dir;
      const side = (w.dir > 0 ? 0.6 : -0.6) * M * Math.min(E, 2);
      const x = probe.x - hz * side;
      const z = probe.z + hx * side;
      const y = gy(x, z);
      const yaw = Math.atan2(hx, hz);
      const k = s * w.show;
      if (w.kind === "bike") {
        put("bikes", at(x, y, z, yaw, k, k, k), DARK);
        put("riders", at(x, y + 0.72 * k, z, yaw, k, k, k, 0.35), w.shirt);
        put("heads", at(x + hx * 0.2 * k, y + 1.35 * k, z + hz * 0.2 * k, yaw, k, k, k), w.skin);
      } else {
        const run = w.kind === "run";
        const bob = Math.abs(Math.sin((t * (run ? 2.7 : 1.9) + w.phase) * Math.PI)) * (run ? 0.09 : 0.03);
        person(x, y, z, yaw, k, w.shirt, w.skin, bob, run ? 0.18 : 0.04);
        if (w.dog) {
          const dx = x - hz * 0.9 * k + hx * 0.9 * k;
          const dz = z + hx * 0.9 * k + hz * 0.9 * k;
          put("dogs", at(dx, gy(dx, dz), dz, yaw, k, k, k), w.dog);
        }
      }
    }

    // Lawns, meadow, playground and splash pad.
    const dayOn = inWindow(tod, [0.27, 0.82]);
    if (dayOn > 0.05) {
      const kk = s * dayOn;
      for (const r of sim.roamers) {
        if (dt > 0) {
          const a = Math.atan2(r.hz, r.hx) + (Math.random() - 0.5) * dt * (r.skin ? 1.2 : 3.5);
          r.hx = Math.cos(a);
          r.hz = Math.sin(a);
          const nx = r.x + r.hx * r.speed * dt;
          const nz = r.z + r.hz * r.speed * dt;
          if (pointInPoly(r.area, nx, nz)) {
            r.x = nx;
            r.z = nz;
          } else {
            r.hx = -r.hx;
            r.hz = -r.hz;
          }
        }
        const yaw = Math.atan2(r.hx, r.hz);
        const y = gy(r.x, r.z);
        const k = kk * r.size;
        if (r.skin) {
          const bob = Math.abs(Math.sin((t * (r.size < 1 ? 3 : 1.9) + r.phase) * Math.PI)) * (r.size < 1 ? 0.08 : 0.03);
          person(r.x, y, r.z, yaw, k, r.color, r.skin, bob, 0.04);
        } else {
          const hop = Math.abs(Math.sin(t * 8 + r.phase)) * 0.12;
          put("dogs", at(r.x, y + hop * k, r.z, yaw, k, k, k), r.color);
        }
      }
      for (const b of sim.groups) {
        const y = gy(b.x, b.z);
        const cy = Math.cos(b.yaw);
        const sy = Math.sin(b.yaw);
        put("flats", at(b.x, y, b.z, b.yaw, 2.2 * kk, 0.03 * kk, 1.8 * kk), b.blanket);
        for (const m of b.people) {
          const px = b.x + (m.dx * cy + m.dz * sy) * kk;
          const pz = b.z + (-m.dx * sy + m.dz * cy) * kk;
          const yaw = Math.atan2(b.x - px, b.z - pz);
          put("seated", at(px, y + 0.03 * kk, pz, yaw, kk, kk, kk), m.shirt);
          put("heads", at(px, y + 0.8 * kk, pz, yaw, kk, kk, kk), m.skin);
        }
      }
      for (const pr of sim.pairs) {
        const ya = gy(pr.ax, pr.az);
        const yawA = Math.atan2(pr.bx - pr.ax, pr.bz - pr.az);
        person(pr.ax, ya, pr.az, yawA, kk, pr.shirts[0], pr.skins[0]);
        person(pr.bx, gy(pr.bx, pr.bz), pr.bz, yawA + Math.PI, kk, pr.shirts[1], pr.skins[1]);
        const cyc = (t * 0.45 + pr.phase * 2) % 2;
        const f = cyc < 1 ? cyc : 2 - cyc;
        const e = f * f * (3 - 2 * f);
        put("balls", at(pr.ax + (pr.bx - pr.ax) * e, ya + (1.2 + Math.sin(Math.PI * f) * 3.5) * kk, pr.az + (pr.bz - pr.az) * e, t * 6, kk * 1.6, kk * 0.3, kk * 1.6), DISC);
      }
      // People in hammocks: the fabric sags in three panels from strap to strap. (Kept nearer
      // true size than the crowds, so they lie within their hammocks from afar.)
      const kh = Math.min(E, 2.2) * M * dayOn;
      for (const h of sim.hammocks) {
        const ya = gy(h.ax, h.az) + 1.5 * M;
        const yb = gy(h.bx, h.bz) + 1.5 * M;
        const yaw = Math.atan2(h.bx - h.ax, h.bz - h.az);
        const sag = 0.9 * M;
        const pts = [0, 0.3, 0.7, 1].map((f) => [h.ax + (h.bx - h.ax) * f, ya + (yb - ya) * f - sag * Math.sin(Math.PI * f) * (f === 0 || f === 1 ? 0 : 1), h.az + (h.bz - h.az) * f]);
        for (let i = 0; i < 3; i++) {
          const [x0, y0, z0] = pts[i];
          const [x1, y1, z1] = pts[i + 1];
          const len = Math.hypot(x1 - x0, z1 - z0);
          put("fabric", at((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, yaw, 0.9 * M * Math.min(E, 2.5) * dayOn, 0.05 * M, len, Math.atan2(y0 - y1, len)), h.color);
        }
        const mid = pts[1];
        put("lying", at((pts[1][0] + pts[2][0]) / 2, mid[1] + 0.05 * M, (pts[1][2] + pts[2][2]) / 2, yaw, kh, kh, kh), h.shirt);
        put("heads", at(pts[1][0] - Math.sin(yaw) * 0.2 * kh, mid[1] + 0.15 * kh, pts[1][2] - Math.cos(yaw) * 0.2 * kh, yaw, kh, kh, kh), h.skin);
      }
      // The Treehouse: people lying out on the net, others leaning on the rail.
      const o = sim.info.orb;
      for (const m of sim.netters) {
        const x = o.x + Math.cos(m.a) * m.r * sim.info.orbR;
        const z = o.z + Math.sin(m.a) * m.r * sim.info.orbR;
        if (m.r < 1) put("lying", at(x, o.y + 0.02 * M, z, m.yaw, kk, kk, kk), m.shirt);
        else person(x, o.y, z, m.a + Math.PI, kk, m.shirt, m.skin);
        if (m.r < 1) put("heads", at(x + Math.sin(m.yaw) * 0.85 * kk, o.y + 0.14 * kk, z + Math.cos(m.yaw) * 0.85 * kk, m.yaw, kk, kk, kk), m.skin);
      }
    }
    // The splash pad's jets, when it runs.
    const splashOn = inWindow(tod, [0.32, 0.72]);
    if (splashOn > 0.05) {
      const { x: sx, z: sz } = sim.splash;
      const y = gy(sx, sz);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const r = i % 2 ? 2.6 : 4.4;
        const h = (1.2 + 1.3 * (0.5 + 0.5 * Math.sin(t * 2.2 + i * 1.7))) * splashOn;
        const wj = M * Math.min(E, 2.5);
        put("jets", at(sx + Math.cos(a) * r * M, y, sz + Math.sin(a) * r * M, 0, wj, h * M * 1.3, wj), WATER);
      }
      const wc = M * 2 * Math.min(E, 2.5);
      put("jets", at(sx, y, sz, 0, wc, (2.8 + Math.sin(t * 1.3)) * splashOn * M * 1.3, wc), WATER);
    }
    // Games.
    const gameOn = inWindow(tod, [0.3, 0.88]);
    if (gameOn > 0.05) {
      const kk = s * gameOn;
      for (const c of sim.courts) {
        const f = c.f;
        const pos = (a: number, b: number): [number, number] => {
          const A = a * f.len;
          const B = b * f.wid;
          return [f.cx + A * f.ux - B * f.uz, f.cz + A * f.uz + B * f.ux];
        };
        c.players.forEach((pl, i) => {
          const sway = c.kind === "volley" ? Math.sin(t * 1.3 + pl.phase) * 0.05 : Math.sin(t * 0.7 + pl.phase) * 0.25;
          const swayB = c.kind === "volley" ? Math.cos(t * 1.1 + pl.phase) * 0.08 : Math.cos(t * 0.6 + pl.phase * 2) * 0.25;
          const [x, z] = pos(pl.a + sway, Math.max(-0.45, Math.min(0.45, pl.b + swayB)));
          // Volleyball players face the net; basketball players the ball's end.
          const face = c.kind === "volley" ? (pl.a < 0 ? 1 : -1) : Math.sin(t * 0.2) > 0 ? 1 : -1;
          const yaw = Math.atan2(f.ux * face, f.uz * face);
          const jump = c.kind === "volley" ? Math.max(0, Math.sin(t * 2.4 + i * 1.3)) ** 8 * 0.5 : 0;
          person(x, gy(x, z) + jump * M, z, yaw, kk, pl.shirt, pl.skin);
        });
        if (c.kind === "volley" && c.players.length >= 4) {
          // The ball goes back and forth over the net.
          const cyc = (t * 0.35 + c.f.cx * 997) % 2;
          const fr = cyc < 1 ? cyc : 2 - cyc;
          const [x, z] = pos(-0.32 + 0.64 * fr, 0.05 * Math.sin(t));
          put("balls", at(x, gy(x, z) + (2 + Math.sin(Math.PI * fr) * 4.5) * kk, z, 0, kk * 1.8, kk * 1.8, kk * 1.8), c.ball);
        } else if (c.kind === "hoops") {
          const lead = c.players[0];
          const [x, z] = pos(lead.a + Math.sin(t * 0.7 + lead.phase) * 0.25 + 0.06, lead.b + Math.cos(t * 0.6 + lead.phase * 2) * 0.25);
          const bounce = Math.abs(Math.sin(t * 5.5));
          put("balls", at(x, gy(x, z) + (0.12 + bounce * 0.8) * kk, z, 0, kk * 2, kk * 2, kk * 2), c.ball);
        }
      }
    }

    for (const key of Object.keys(meshes) as (keyof Sim["meshes"])[]) {
      const mesh = meshes[key];
      const k = Math.min(n[key], mesh.instanceMatrix.count);
      mesh.count = k;
      if (k === 0) continue;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, k * 16);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, k * 3);
        mesh.instanceColor.needsUpdate = true;
      }
    }
  });

  return root ? <primitive ref={ref} object={root} /> : null;
}
