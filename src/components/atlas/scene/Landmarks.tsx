"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import earcut from "earcut";
import type { Polyline } from "@/lib/atlas/assets";
import type { Central } from "@/lib/atlas/central";
import { LITTLEFIELD_FOUNTAIN } from "@/data/atlas/campus";
import { DOME as DOME_AT, FOUNTAINS, GREAT_WALK, MONUMENTS, OPEN_ROTUNDA, SKYLIGHTS, SOUTH_FENCE, SOUTH_STEPS } from "@/data/atlas/capitol";
import { CAPITOL_YAW, capitolAt, capitolUV } from "@/lib/atlas/capitol";
import { KIND_PITCHED, KIND_PLAIN, STYLE_CAMPUS_TILE, STYLE_CAPITOL } from "@/lib/atlas/extrude";
import { BUILDING_EXAG, groundY, project, type HeightField } from "@/lib/atlas/geo";
import { coverRectangles, hipRoof } from "@/lib/atlas/roofs";
import { runtime } from "@/lib/atlas/store";
import { sky } from "@/lib/atlas/timeOfDay";
import Buildings from "./Buildings";
import { aoCaster } from "./Occlusion";
import { pullTowardCamera, radialTexture } from "./glow";

// Austin's landmarks as procedural low-poly models: the Texas State Capitol in sunset-red
// granite and its grounds, with the Governor's Mansion, the Old Land Office and St. Mary
// Cathedral around them, the UT Tower (lit burnt orange at night), the moonlight towers, the
// pavilion on Mount Bonnell and the Pennybacker Bridge's steel arch over Lake Austin. Heights
// get the buildings' vertical boost so the skyline keeps its proportions.

const M = 0.001; // metres -> km
const V = M * BUILDING_EXAG; // vertical metres -> km, boosted like the buildings
const UP = new THREE.Vector3(0, 1, 0);

const GRANITE = "#c58e79";
const GRANITE_LIGHT = "#d6a994";
const DOME = "#dcbfa9";
const STATUE = "#6f6a5c";
const LIMESTONE = "#e6dac3";
const LIMESTONE_SHADE = "#cdbfa6";
const TILE = "#b35a3c";
const CLOCK = "#3d352c";
const STEEL = "#8c4a2b";
const CONCRETE = "#cfc8bc";
const WINDOW_BAY = "#8a7c6a";
const FOUNTAIN = "#6e9fae";
const BRONZE = "#5b4a36";

/** Coloured triangles from many parts, merged into one flat-shaded geometry. */
class Mesher {
  private pos: number[] = [];
  private col: number[] = [];

  /** Add a part authored in metres (y up, origin at the anchor), placed by `frame`. */
  add(g: THREE.BufferGeometry, color: string, frame: THREE.Matrix4) {
    const geo = g.index ? g.toNonIndexed() : g.clone();
    geo.applyMatrix4(frame);
    const p = geo.attributes.position.array;
    const c = new THREE.Color(color);
    for (let i = 0; i < p.length; i++) this.pos.push(p[i]);
    for (let i = 0; i < p.length / 3; i++) this.col.push(c.r, c.g, c.b);
  }

  /** A triangle in world coordinates. */
  tri(a: number[], b: number[], c: number[], color: THREE.Color) {
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.col.push(color.r, color.g, color.b);
  }

  quad(a: number[], b: number[], c: number[], d: number[], color: THREE.Color) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals(); // non-indexed, so every facet is flat
    g.computeBoundingSphere();
    return g;
  }
}

/** Placement for parts authored in metres: anchor, heading, and the metres -> km scale. */
function frame(x: number, y: number, z: number, yaw = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(UP, yaw),
    new THREE.Vector3(M, V, M),
  );
}

/** Box standing on y (metres). */
function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return g;
}

/** Cylinder standing on y (metres). */
function cyl(rTop: number, rBottom: number, h: number, y: number, seg = 24, x = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1);
  g.translate(x, y + h / 2, z);
  return g;
}

/** Dome: a half-ellipsoid of radius r and height h standing on y. */
function dome(r: number, h: number, y: number, seg = 24, rings = 8): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, seg, rings, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1, h / r, 1);
  g.translate(0, y, 0);
  return g;
}

/** A gable: triangle of base w and height h in the x-y plane, d deep along z, standing on y. */
function gable(w: number, h: number, d: number, y: number, z: number): THREE.BufferGeometry {
  const x0 = -w / 2;
  const x1 = w / 2;
  const z0 = z - d / 2;
  const z1 = z + d / 2;
  const t = y + h;
  // prettier-ignore
  const v = [
    x0, y, z1, x1, y, z1, 0, t, z1,
    x1, y, z0, x0, y, z0, 0, t, z0,
    x0, y, z0, x0, y, z1, 0, t, z1, x0, y, z0, 0, t, z1, 0, t, z0,
    x1, y, z1, x1, y, z0, 0, t, z0, x1, y, z1, 0, t, z0, 0, t, z1,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  return g;
}

function ring(poly: Polyline): Float32Array {
  const n = poly.length / 2;
  const closed = n > 3 && poly[0] === poly[n * 2 - 2] && poly[1] === poly[n * 2 - 1];
  return closed ? poly.subarray(0, n * 2 - 2) : poly;
}

/** Ground range under an outline. */
function groundRange(ground: HeightField, outline: Polyline): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < outline.length; i += 2) {
    const y = groundY(ground, outline[i], outline[i + 1]);
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  return [lo, hi];
}

/** A footprint in world coordinates, extruded from y0 to a flat roof at y1. */
function extrude(ms: Mesher, outline: Polyline, y0: number, y1: number, wall: string, roof: string) {
  const r = ring(outline);
  const n = r.length / 2;
  const cw = new THREE.Color(wall);
  const cr = new THREE.Color(roof);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    ms.quad([r[i * 2], y0, r[i * 2 + 1]], [r[j * 2], y0, r[j * 2 + 1]], [r[j * 2], y1, r[j * 2 + 1]], [r[i * 2], y1, r[i * 2 + 1]], cw);
  }
  const idx = earcut(Array.from(r));
  const p = (q: number) => [r[q * 2], y1, r[q * 2 + 1]];
  for (let k = 0; k < idx.length; k += 3) ms.tri(p(idx[k]), p(idx[k + 2]), p(idx[k + 1]), cr);
}

// ---------------------------------------------------------------- the Capitol

const GRANITE_DARK = "#a9725f";
const DOME_SHADE = "#cdb09b";
const SKY_GLASS = "#9fb4b9";
const IRON = "#34302c";
const GOLD = "#d9ab3f";
const PAVING = "#e6dfd2";
const PAVING_EDGE = "#b8ad9b";
const MANSION = "#f0e8d6";
const WHITE = "#f5f2eb";
const SLATE = "#6f6964";

/** Metres in the Capitol's frame, for parts placed by `capitolFrame` (+x along u, -z along v). */
const capitolFrame = (y: number) => {
  const [x, z] = capitolAt(0, 0);
  return frame(x, y, z, CAPITOL_YAW);
};

/** A triangular pediment w wide and h high, d deep, on y, centred on (x, z); turned faces +-x. */
function pediment(w: number, h: number, d: number, y: number, x: number, z: number, turn = false): THREE.BufferGeometry {
  const g = gable(w, h, d, y, 0);
  if (turn) g.rotateY(Math.PI / 2);
  g.translate(x, 0, z);
  return g;
}

/** Highest ground under a rectangle in the Capitol's frame (u0..u1, v0..v1). */
function capitolGroundMax(ground: HeightField, u0: number, u1: number, v0: number, v1: number): number {
  let hi = -Infinity;
  for (const u of [u0, (u0 + u1) / 2, u1]) for (const v of [v0, (v0 + v1) / 2, v1]) hi = Math.max(hi, groundY(ground, ...capitolAt(u, v)));
  return hi;
}

/**
 * The Texas State Capitol (1888), in sunset-red granite: the long east-west block with its end
 * pavilions, windows between pilasters over a rusticated ground floor (drawn by the buildings'
 * shader, in the Capitol's style), the south portico over the steps down to the Great Walk, the
 * north portico, pediments on the ends, the legislative chambers' skylights, and the dome: a
 * colonnaded drum, a ribbed shell with lucarnes, and the lantern under the Goddess of Liberty,
 * 92 m up. Floodlit after dark, the dome brightest.
 */
function capitol(ms: Mesher, lit: Mesher, warm: Mesher, glass: GlassOut, c: Central, ground: HeightField) {
  const outline = c.landmarks.capitol?.outline;
  const [ax, az] = capitolAt(0, 0);
  const [lo, hi] = outline ? groundRange(ground, outline) : [groundY(ground, ax, az), groundY(ground, ax, az)];
  const roofM = 24;
  const roofY = hi + roofM * V;
  if (outline) {
    const r = ring(outline);
    const walls = new GlassMesher(lo, roofM + (hi - lo) / V, 0.1 + STYLE_CAPITOL);
    walls.prism(r, lo - 0.003, roofY);
    walls.append(glass);
    // The balustrade along the roofline.
    const n = r.length / 2;
    const cb = new THREE.Color(GRANITE_LIGHT);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = [r[i * 2], r[i * 2 + 1]];
      const b = [r[j * 2], r[j * 2 + 1]];
      ms.quad([a[0], roofY, a[1]], [b[0], roofY, b[1]], [b[0], roofY + 1.5 * V, b[1]], [a[0], roofY + 1.5 * V, a[1]], cb);
    }
  }
  const f = capitolFrame(roofY);
  const rel = (y: number) => (y - roofY) / V; // world y -> metres from the roofline

  // The south portico: an arcaded ground floor, six columns up two storeys, the entablature and
  // the pediment, over the steps down to the Great Walk.
  const gS = rel(capitolGroundMax(ground, -13, 17, -46, -42));
  const deck = gS + 6.5;
  ms.add(box(30, deck - gS + 3, 4, 2, gS - 3, 43.8), GRANITE_DARK, f);
  for (let i = 0; i < 6; i++) ms.add(cyl(0.75, 0.85, -2.5 - deck, deck, 12, -10.5 + i * 5, 44.9), GRANITE_LIGHT, f);
  ms.add(box(31, 2.5, 4.6, 2, -2.5, 43.8), GRANITE, f);
  ms.add(pediment(31, 6.5, 4.6, 0, 2, 43.8), GRANITE, f);
  // The south steps, six flights wide.
  const st = SOUTH_STEPS;
  const gFoot = rel(groundY(ground, ...capitolAt(2, st.from)));
  const rise = Math.max(0.2, (gS + 1.6 - gFoot) / 6);
  for (let i = 0; i < 6; i++) {
    const v0 = st.from + ((st.to - st.from) * i) / 6;
    ms.add(box(st.width, gFoot + rise * (i + 1) - (gFoot - 2), st.to - v0, 2, gFoot - 2, -(v0 + st.to) / 2), LIMESTONE_SHADE, f);
  }
  // The north portico, smaller.
  const gN = rel(capitolGroundMax(ground, -7, 11, 47, 51));
  ms.add(box(19, gN + 5.5 - (gN - 3), 3.2, 1.8, gN - 3, -48.9), GRANITE_DARK, f);
  for (let i = 0; i < 4; i++) ms.add(cyl(0.65, 0.75, -2.2 - (gN + 5.5), gN + 5.5, 12, -4.2 + i * 4, -49.8), GRANITE_LIGHT, f);
  ms.add(box(19, 2.2, 3.4, 1.8, -2.2, -48.9), GRANITE, f);
  ms.add(pediment(19, 4.6, 3.4, 0, 1.8, -48.9), GRANITE, f);
  // Pediments over the east and west ends, and the chambers' skylights in the end pavilions:
  // the Senate's to the east, the House's to the west.
  for (const [u, s] of [
    [84.8, 1],
    [-82.2, -1],
  ]) {
    ms.add(pediment(26, 5.2, 1.6, 0, u - s * 0.8, 4.6, true), GRANITE, f);
    const sky = new THREE.ConeGeometry(1, 2.6, 4, 1);
    sky.rotateY(Math.PI / 4);
    sky.scale(8.5, 1, 6);
    sky.translate(u - s * 16, 1.3 + 0.9, 4.6);
    warm.add(sky, SKY_GLASS, f);
    ms.add(box(13, 0.9, 9.4, u - s * 16, 0, 4.6), GRANITE_LIGHT, f);
  }

  // The dome, over the rotunda.
  const dx = DOME_AT[0];
  const dz = -DOME_AT[1];
  const at = (g: THREE.BufferGeometry) => g.translate(dx, 0, dz);
  ms.add(box(36, 5, 36, dx, 0, dz), GRANITE, f);
  ms.add(box(38, 1.2, 38, dx, 5, dz), GRANITE_LIGHT, f);
  lit.add(cyl(15.6, 15.6, 14.2, 6.2, 36, dx, dz), DOME_SHADE, f);
  for (let i = 0; i < 12; i++) {
    const a = ((i + 0.5) / 12) * Math.PI * 2;
    const w = box(1.9, 7.5, 0.6, 0, 9.4, 15.5);
    w.rotateY(a);
    ms.add(at(w), CLOCK, f);
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    lit.add(cyl(0.62, 0.7, 14.2, 6.2, 10, dx + Math.cos(a) * 17.3, dz + Math.sin(a) * 17.3), DOME, f);
  }
  lit.add(cyl(18.4, 18.4, 1.4, 20.4, 36, dx, dz), DOME, f);
  lit.add(cyl(15.2, 15.8, 4.5, 21.8, 36, dx, dz), DOME, f);
  for (let i = 0; i < 12; i++) {
    const w = box(1.5, 1.1, 0.5, 0, 23.5, 15.4);
    w.rotateY((i / 12) * Math.PI * 2);
    ms.add(at(w), CLOCK, f);
  }
  // The shell in gores, alternately lit, so its ribs show; lucarnes round its foot.
  for (let k = 0; k < 16; k++) {
    const g = new THREE.SphereGeometry(15.2, 2, 8, (k / 16) * Math.PI * 2, Math.PI / 8, 0, Math.PI / 2);
    g.scale(1, 21.2 / 15.2, 1);
    g.translate(0, 26.3, 0);
    lit.add(at(g), k % 2 ? DOME : DOME_SHADE, f);
  }
  for (let i = 0; i < 8; i++) {
    const g = box(1.6, 2.4, 2.2, 0, 28.6, 15);
    g.rotateY(((i + 0.5) / 8) * Math.PI * 2);
    lit.add(at(g), DOME, f);
  }
  // The lantern: a colonnaded cupola, its cap, and the Goddess of Liberty with her gilt star.
  lit.add(cyl(4.4, 4.8, 1.2, 47.2, 16, dx, dz), DOME, f);
  lit.add(cyl(2.7, 2.7, 5.8, 48.4, 12, dx, dz), DOME_SHADE, f);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    lit.add(cyl(0.3, 0.34, 5.8, 48.4, 8, dx + Math.cos(a) * 3.6, dz + Math.sin(a) * 3.6), DOME, f);
  }
  lit.add(cyl(4.4, 4.4, 1, 54.2, 16, dx, dz), DOME, f);
  lit.add(at(dome(3.8, 3, 55.2, 16, 5)), DOME, f);
  lit.add(cyl(0.9, 1.2, 1.6, 58.2, 8, dx, dz), DOME, f);
  ms.add(cyl(0.45, 0.8, 3.6, 59.8, 8, dx, dz), STATUE, f);
  ms.add(at(dome(0.5, 0.9, 63.4, 8, 3)), STATUE, f);
  ms.add(box(0.3, 2.3, 0.3, dx + 0.75, 62.6, dz), STATUE, f); // her raised arm
  const star = new THREE.OctahedronGeometry(0.75, 0);
  star.translate(dx + 0.75, 65.3, dz);
  lit.add(star, GOLD, f);
}

/**
 * The Capitol's grounds: the Great Walk from the south gate to the steps, lamps along it, the
 * iron fence on 11th Street, the south lawn's two fountains, the monuments (each a rough version
 * of its form), and on the north lawn the Capitol Extension's skylights and its open-air
 * rotunda, three storeys down to a star.
 */
function capitolGrounds(ms: Mesher, pave: Mesher, warm: Mesher, glow: number[], ground: HeightField) {
  const lift = 0.0004;
  // The Great Walk, draped on the slope, with its kerbs.
  const w = GREAT_WALK;
  const cp = new THREE.Color(PAVING);
  const ck = new THREE.Color(PAVING_EDGE);
  const pt = (u: number, v: number, dy = 0) => {
    const [x, z] = capitolAt(u, v);
    return [x, groundY(ground, x, z) + lift + dy, z];
  };
  for (let v = w.from; v < w.to; v += 6) {
    const v1 = Math.min(w.to, v + 6);
    const [a, b, c2, d] = [pt(w.u - w.width / 2, v), pt(w.u + w.width / 2, v), pt(w.u + w.width / 2, v1), pt(w.u - w.width / 2, v1)];
    pave.quad(a, b, c2, d, cp);
    for (const [p, q] of [
      [a, d],
      [b, c2],
    ]) {
      pave.quad(p, q, [q[0], q[1] - 0.0007, q[2]], [p[0], p[1] - 0.0007, p[2]], ck);
    }
  }
  // Lamps along it, and at the gate.
  for (let v = -204; v <= -62; v += 15.8) {
    for (const s of [-1, 1]) {
      const [x, z] = capitolAt(w.u + s * 5.4, v);
      const y = groundY(ground, x, z);
      pave.add(box(0.18, 4.2, 0.18, 0, 0, 0), IRON, frame(x, y, z));
      warm.add(box(0.5, 0.75, 0.5, 0, 4.2, 0), "#f3e3c3", frame(x, y, z));
      glow.push(x, y + 4.6 * V, z);
    }
  }
  // The fence along 11th Street: iron pickets between granite piers, and the gates.
  const fz = SOUTH_FENCE;
  const inGate = (u: number, pad = 0) => fz.gates.some(([g, gw]) => Math.abs(u - g) < gw / 2 + pad);
  for (let u = fz.from; u <= fz.to; u += 2.5) {
    if (inGate(u)) continue;
    const [x, z] = capitolAt(u, fz.v);
    const y = groundY(ground, x, z);
    const f = frame(x, y, z, CAPITOL_YAW);
    pave.add(box(0.12, 2.1, 0.12, 0, 0, 0), IRON, f);
    if (u + 2.5 <= fz.to && !inGate(u + 2.5)) {
      pave.add(box(2.5, 0.09, 0.09, 1.25, 1.95, 0), IRON, f);
      pave.add(box(2.5, 0.09, 0.09, 1.25, 0.35, 0), IRON, f);
    }
  }
  for (const [g, gw] of fz.gates) {
    for (const s of [-1, 1]) {
      const [x, z] = capitolAt(g + s * (gw / 2 + 0.7), fz.v);
      const y = groundY(ground, x, z);
      const big = g === GREAT_WALK.u;
      const f = frame(x, y, z, CAPITOL_YAW);
      ms.add(box(big ? 1.4 : 1, big ? 4.4 : 3, big ? 1.4 : 1, 0, -0.5, 0), GRANITE, f);
      ms.add(box(big ? 1.7 : 1.3, 0.4, big ? 1.7 : 1.3, 0, big ? 3.9 : 2.5, 0), GRANITE_LIGHT, f);
      if (big) {
        warm.add(box(0.6, 0.9, 0.6, 0, 4.3, 0), "#f3e3c3", f);
        glow.push(x, y + 4.8 * V, z);
      }
    }
  }
  // The south lawn's fountains.
  for (const [u, v] of FOUNTAINS) {
    const [x, z] = capitolAt(u, v);
    let lo2 = Infinity;
    let hi2 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const y = groundY(ground, x + Math.cos(a) * 6 * M, z + Math.sin(a) * 6 * M);
      lo2 = Math.min(lo2, y);
      hi2 = Math.max(hi2, y);
    }
    const f = frame(x, lo2 - 0.0003, z, CAPITOL_YAW);
    const w0 = (hi2 - lo2) / V + 0.5;
    pave.add(cyl(6, 6.2, w0 - 0.25, 0, 28), PAVING, f);
    ms.add(rim(3, 3.6, w0 + 0.45, 0, 28), GRANITE_LIGHT, f);
    ms.add(cyl(3, 3, w0, 0, 28), FOUNTAIN, f);
    ms.add(cyl(0.9, 1.1, w0 + 0.7, 0, 12), GRANITE, f);
    ms.add(cyl(1.5, 0.9, 0.35, w0 + 0.7, 14), GRANITE_LIGHT, f);
    ms.add(cyl(0.18, 0.24, 0.9, w0 + 1.05, 8), GRANITE, f);
  }
  // The monuments.
  for (const m of MONUMENTS) {
    const [x, z] = project(...m.at);
    const f = frame(x, groundY(ground, x, z) - 0.0003, z, CAPITOL_YAW);
    const h = m.h;
    if (m.kind === "column") {
      ms.add(box(h > 10 ? 6 : 4.2, 1.4, h > 10 ? 6 : 4.2, 0, 0, 0), GRANITE_DARK, f);
      ms.add(box(2.6, 2.6, 2.6, 0, 1.4, 0), GRANITE, f);
      ms.add(cyl(0.7, 0.95, h - 5.6, 4, 10), GRANITE_LIGHT, f);
      ms.add(cyl(0.34, 0.45, 1.8, h - 1.6, 8), BRONZE, f);
      if (h > 10) for (const [sx, sz] of [[-2.3, -2.3], [2.3, -2.3], [2.3, 2.3], [-2.3, 2.3]]) ms.add(cyl(0.3, 0.36, 1.8, 1.4, 8, sx, sz), BRONZE, f);
    } else if (m.kind === "statue") {
      ms.add(box(2.4, 1.8, 2.4, 0, 0, 0), GRANITE, f);
      ms.add(cyl(0.34, 0.45, h - 1.8, 1.8, 8), BRONZE, f);
    } else if (m.kind === "rider") {
      ms.add(box(2.6, 2.2, 4.2, 0, 0, 0), GRANITE, f);
      ms.add(box(1, 1.4, 2.8, 0, 2.2, 0), BRONZE, f);
      ms.add(box(0.7, 1.2, 0.8, 0, 3.2, -1.3), BRONZE, f);
      ms.add(cyl(0.28, 0.34, 1.4, 3.4, 8, 0, 0.3), BRONZE, f);
    } else if (m.kind === "group") {
      ms.add(box(8, 1.2, 5, 0, 0, 0), GRANITE_DARK, f);
      ms.add(box(3.6, h - 1.2, 1.4, 0, 1.2, 1.2), GRANITE, f);
      for (const [sx, sz, sh] of [[-2.6, -0.8, 2], [-1, -1.2, 2.2], [1.2, -1, 1.9], [2.8, -0.4, 2.1]]) ms.add(cyl(0.32, 0.4, sh, 1.2, 8, sx, sz), BRONZE, f);
    } else if (m.kind === "wall") {
      pave.add(box(14, 0.4, 7, 0, 0, 0), PAVING, f);
      ms.add(box(11, h, 1, 0, 0.4, 1.2), GRANITE_DARK, f);
      ms.add(box(6.5, h - 1.6, 0.35, 0, 1.2, 0.55), BRONZE, f);
    } else {
      pave.add(cyl(9, 9, 0.4, 0, 28), PAVING, f);
      ms.add(rim(6.6, 7.4, 0.4 + h, 0, 28), GRANITE_DARK, f);
      ms.add(cyl(0.9, 1.2, 2.4, 0.4, 10), GRANITE, f);
      ms.add(cyl(0.3, 0.4, 1.9, 2.8, 8), BRONZE, f);
    }
  }
  // The Capitol Extension: glass skylights over the lawn, and the open-air rotunda.
  for (const [u, v, a, b] of SKYLIGHTS) {
    const y = capitolGroundMax(ground, u - a / 2, u + a / 2, v - b / 2, v + b / 2);
    const [x, z] = capitolAt(u, v);
    const f = frame(x, y, z, CAPITOL_YAW);
    ms.add(box(a + 0.8, 0.9, b + 0.8, 0, -0.6, 0), GRANITE_LIGHT, f);
    const g = a >= b ? pediment(b, Math.min(a, b) * 0.22, a, 0.3, 0, 0, true) : pediment(a, Math.min(a, b) * 0.22, b, 0.3, 0, 0);
    warm.add(g, SKY_GLASS, f);
  }
  const ro = OPEN_ROTUNDA;
  const yR = capitolGroundMax(ground, ro.u - ro.r, ro.u + ro.r, ro.v - ro.r, ro.v + ro.r);
  const [rx, rz] = capitolAt(ro.u, ro.v);
  const fr = frame(rx, yR, rz, CAPITOL_YAW);
  ms.add(rim(ro.r, ro.r + 0.7, 1.9, -0.8, 40), GRANITE_LIGHT, fr);
  // Looking down the well: galleries stepping in and darkening, and the star on its floor.
  const well: [number, number, string][] = [
    [ro.r, ro.r - 0.8, "#8f7b70"],
    [ro.r - 0.8, ro.r - 2, "#6f5f57"],
    [ro.r - 2, ro.r - 3.4, "#54483f"],
  ];
  for (const [r0, r1, col] of well) ms.add(rim(r1, r0, 0.25, -0.2, 40), col, fr);
  ms.add(cyl(ro.r - 3.4, ro.r - 3.4, 0.25, -0.2, 40), "#7b6f64", fr);
  const sp: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? 1.5 : 3.8;
    sp.push(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const starShape = new THREE.Shape();
  starShape.moveTo(sp[0], sp[1]);
  for (let i = 2; i < sp.length; i += 2) starShape.lineTo(sp[i], sp[i + 1]);
  const sg = new THREE.ShapeGeometry(starShape);
  sg.rotateX(-Math.PI / 2);
  sg.translate(0, 0.15, 0);
  ms.add(sg, "#e2d8c6", fr);
}

// ---------------------------------------------------------------- around the Capitol

/** Hip roofs over a footprint (its rectangles), rising from y. */
function hipRoofs(ms: Mesher, outline: Polyline, y: number, color: string, pitch: number, maxRiseKm: number) {
  const r = ring(outline);
  const b = obb(outline);
  const c = new THREE.Color(color);
  for (const rect of coverRectangles(r, [0], r[0], r[1], b.ux, b.uz)) {
    const h = hipRoof(rect, r[0], r[1], b.ux, b.uz, 0.0005, pitch, maxRiseKm);
    const top = y + h.rise * BUILDING_EXAG;
    const [e0, e1, e2, e3] = h.eaves.map(([x, z]) => [x, y, z]);
    const [r0, r1] = h.ridge.map(([x, z]) => [x, top, z]);
    ms.tri(e0, e1, r1, c);
    ms.tri(e0, r1, r0, c);
    ms.tri(e2, e3, r0, c);
    ms.tri(e2, r0, r1, c);
    ms.tri(e3, e0, r0, c);
    ms.tri(e1, e2, r1, c);
  }
}

/** The side of a footprint's box facing most nearly along (dx, dz): its centre, direction and length. */
function facing(outline: Polyline, dx: number, dz: number) {
  const b = obb(outline);
  const sides = [
    { n: [b.ux, b.uz], half: b.A, len: b.B * 2 },
    { n: [-b.ux, -b.uz], half: b.A, len: b.B * 2 },
    { n: [-b.uz, b.ux], half: b.B, len: b.A * 2 },
    { n: [b.uz, -b.ux], half: b.B, len: b.A * 2 },
  ];
  const s = sides.reduce((p, q) => (q.n[0] * dx + q.n[1] * dz > p.n[0] * dx + p.n[1] * dz ? q : p));
  return { x: b.cx + s.n[0] * s.half, z: b.cz + s.n[1] * s.half, nx: s.n[0], nz: s.n[1], len: s.len / M };
}

/**
 * The Governor's Mansion (1856): Greek Revival in pale painted brick under a low hip roof, the
 * six tall Ionic columns of its front portico facing Colorado Street, a gallery across them.
 */
function governorsMansion(ms: Mesher, c: Central, ground: HeightField) {
  const o = c.landmarks["governors-mansion"]?.outline;
  if (!o) return;
  const [lo, hi] = groundRange(ground, o);
  const top = hi + 10.5 * V;
  extrude(ms, o, lo - 0.002, top, MANSION, MANSION);
  hipRoofs(ms, o, top, SLATE, 0.32, 0.004);
  // Colorado Street lies along the grid's east.
  const [ex, ez] = capitolAt(1, 0);
  const [cx0, cz0] = capitolAt(0, 0);
  const s = facing(o, ex - cx0, ez - cz0);
  // The porch floor, a step above the ground in front (the terrain is smoothed on this slope).
  const floor = Math.max(groundY(ground, s.x, s.z), (lo + hi) / 2);
  const f = frame(s.x, floor - 0.0015, s.z, Math.atan2(s.nx, s.nz));
  const base = 1.5;
  const w = Math.min(20, s.len - 3);
  ms.add(box(w + 2, base, 4.2, 0, 0, 2), LIMESTONE_SHADE, f);
  for (let i = 0; i < 6; i++) ms.add(cyl(0.48, 0.56, 9, base, 12, -w / 2 + (w * i) / 5, 3.4), WHITE, f);
  ms.add(box(w + 2, 1.1, 4.4, 0, base + 9, 2), WHITE, f);
  ms.add(box(w, 0.25, 3.2, 0, base + 4.2, 1.6), WHITE, f); // the gallery
}

/**
 * The Old General Land Office (1857), now the Capitol Visitors Center: a castellated stone block
 * in the German Romanesque of its architect, crenellations all round its parapet.
 */
function landOffice(ms: Mesher, c: Central, ground: HeightField) {
  const o = c.landmarks["land-office"]?.outline;
  if (!o) return;
  const [lo, hi] = groundRange(ground, o);
  const top = hi + 13 * V;
  extrude(ms, o, lo - 0.002, top, "#dccbaa", "#bfae90");
  const r = ring(o);
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = r[j * 2] - r[i * 2];
    const dz = r[j * 2 + 1] - r[i * 2 + 1];
    const L = Math.hypot(dx, dz) / M;
    const k = Math.max(1, Math.floor(L / 1.9));
    for (let q = 0; q < k; q++) {
      const t = (q + 0.5) / k;
      ms.add(box(1, 1.3, 0.6, 0, 0, 0), "#d2c09c", frame(r[i * 2] + dx * t, top, r[i * 2 + 1] + dz * t, Math.atan2(-dz, dx)));
    }
  }
}

/**
 * St. Mary Cathedral (1884), Gothic Revival in limestone: the nave under a steep slate roof, and
 * its bell tower and spire at the front, on 10th Street.
 */
function stMary(ms: Mesher, c: Central, ground: HeightField) {
  const o = c.landmarks["st-mary"]?.outline;
  if (!o) return;
  const [lo, hi] = groundRange(ground, o);
  const eave = hi + 14 * V;
  extrude(ms, o, lo - 0.002, eave, "#dacdb3", "#dacdb3");
  const b = obb(o);
  const A = b.A / M;
  const B = b.B / M;
  ms.add(gable(B * 2, B * 1.15, A * 2, 0, 0), SLATE, frame(b.cx, eave, b.cz, Math.atan2(b.ux, b.uz)));
  // The front: the end of the nave toward 10th Street (the grid's south).
  const [e0x, e0z] = b.at(b.A, 0);
  const [e1x, e1z] = b.at(-b.A, 0);
  const south = capitolUV(e0x, e0z)[1] < capitolUV(e1x, e1z)[1];
  const [tx, tz] = b.at((south ? 1 : -1) * (b.A - 0.004), 0);
  const ft = frame(tx, lo - 0.001, tz, Math.atan2(b.ux, b.uz));
  const base = (hi - lo) / V;
  ms.add(box(8, base + 27, 8, 0, 0, 0), "#d3c6ab", ft);
  const spire = new THREE.ConeGeometry(4.6, 15, 8, 1);
  spire.rotateY(Math.PI / 8);
  spire.translate(0, base + 27 + 7.5, 0);
  ms.add(spire, SLATE, ft);
  ms.add(box(0.4, 2.2, 0.4, 0, base + 42, 0), STATUE, ft); // the cross
}

// ---------------------------------------------------------------- the UT Tower

/**
 * The University of Texas Main Building and Tower (1937): limestone under red tile, the shaft
 * rising 94 m to a colonnaded belfry and a small pyramid roof. The shaft is lit orange at night.
 */
function utTower(ms: Mesher, soft: Mesher, hot: Mesher, glass: GlassOut, c: Central, ground: HeightField) {
  const outline = c.landmarks["ut-tower"]?.outline;
  const [ux, uz] = project(-97.73943, 30.28619);
  const [lo, hi] = outline ? groundRange(ground, outline) : [groundY(ground, ux, uz), groundY(ground, ux, uz)];
  const roofM = 18;
  const roofY = hi + roofM * V;
  if (outline) {
    // The Main Building: limestone with punched windows under red tile hip roofs, like the campus
    // around it (drawn by the buildings' shader in its campus style).
    const r = ring(outline);
    const walls = new GlassMesher(lo - 0.003, roofM, 0.1 + STYLE_CAMPUS_TILE);
    walls.prism(r, lo - 0.003, roofY);
    walls.append(glass);
    const b = obb(outline);
    const roofs = new GlassMesher(lo - 0.003, roofM, 0.1 + STYLE_CAMPUS_TILE, KIND_PITCHED);
    for (const rect of coverRectangles(r, [0], r[0], r[1], b.ux, b.uz)) {
      const h = hipRoof(rect, r[0], r[1], b.ux, b.uz, 0.0006, 0.42, 0.009);
      const top = roofY + h.rise * BUILDING_EXAG;
      const [e0, e1, e2, e3] = h.eaves.map(([x, z]) => [x, roofY, z]);
      const [r0, r1] = h.ridge.map(([x, z]) => [x, top, z]);
      roofs.tri(e0, e1, r1);
      roofs.tri(e0, r1, r0);
      roofs.tri(e2, e3, r0);
      roofs.tri(e2, r0, r1);
      roofs.tri(e3, e0, r0);
      roofs.tri(e1, e2, r1);
    }
    roofs.append(glass);
    // The loggia over the south steps, facing the South Mall: columns under an entablature, and
    // the terrace in front. The side facing south is +q when the axis runs east.
    const sq = b.ux >= 0 ? 1 : -1;
    const [lx, lz] = b.at(0, sq * (b.B + 0.004));
    const yaw = -Math.atan2(b.uz, b.ux);
    const loggia = frame(lx, lo - 0.001, lz, yaw);
    ms.add(box(44, (hi - lo) / V + 2.5, 16, 0, 0, sq * 4), LIMESTONE_SHADE, loggia);
    const base = (hi - lo) / V + 2.5;
    for (let i = 0; i < 8; i++) ms.add(cyl(0.75, 0.85, 10, base, 14, -15.75 + i * 4.5, -sq * 2.5), LIMESTONE, loggia);
    ms.add(box(36, 2.2, 5.5, 0, base + 10, -sq * 2.5), LIMESTONE, loggia);
  }
  const f = frame(ux, roofY, uz);

  // The shaft on a rusticated plinth, three bays of windows up each face.
  soft.add(box(21, 5, 21, 0, 0, 0), LIMESTONE_SHADE, f);
  soft.add(box(18, 46, 18, 0, 0, 0), LIMESTONE, f);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    for (const t of [-5.5, 0, 5.5]) {
      const g = box(1.9, 32, 0.4, t, 7, 9);
      g.rotateY(a);
      soft.add(g, WINDOW_BAY, f);
    }
    // Clock faces high on the shaft.
    const g = new THREE.CylinderGeometry(2.6, 2.6, 0.4, 16);
    g.rotateX(Math.PI / 2);
    g.rotateY(a);
    g.translate(Math.sin(a) * 9.1, 41, Math.cos(a) * 9.1);
    ms.add(g, CLOCK, f);
  }
  hot.add(box(21, 1.4, 21, 0, 46, 0), LIMESTONE_SHADE, f);
  hot.add(box(14, 11, 14, 0, 47.4, 0), LIMESTONE, f);
  for (let i = 0; i < 5; i++) {
    const t = -8.8 + i * 4.4;
    for (const [x, z] of [
      [t, -8.8],
      [t, 8.8],
      [-8.8, t],
      [8.8, t],
    ]) {
      hot.add(box(1.3, 11, 1.3, x, 47.4, z), LIMESTONE, f);
    }
  }
  hot.add(box(21, 1.6, 21, 0, 58.4, 0), LIMESTONE_SHADE, f);
  hot.add(box(15, 5, 15, 0, 60, 0), LIMESTONE, f);
  hot.add(box(8.5, 5.5, 8.5, 0, 65, 0), LIMESTONE, f);
  for (const [x, z] of [
    [-4.2, -4.2],
    [4.2, -4.2],
    [4.2, 4.2],
    [-4.2, 4.2],
  ]) {
    hot.add(box(0.9, 5.5, 0.9, x, 65, z), LIMESTONE_SHADE, f);
  }
  const roof = new THREE.ConeGeometry(6.4, 5.5, 4, 1);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 70.5 + 2.75, 0);
  ms.add(roof, TILE, f);
  ms.add(box(0.6, 3, 0.6, 0, 76, 0), STATUE, f);
}

/** A ring wall (a basin's rim): inner and outer radius, height, standing on y. */
function rim(rIn: number, rOut: number, h: number, y: number, seg = 40): THREE.BufferGeometry {
  const p = [new THREE.Vector2(rIn, y), new THREE.Vector2(rIn, y + h), new THREE.Vector2(rOut, y + h), new THREE.Vector2(rOut, y)];
  return new THREE.LatheGeometry(p, seg);
}

/**
 * Littlefield Fountain (1933) at the foot of the South Mall: a round pool behind a limestone
 * rim, and on a stepped island Coppini's bronze ship, Columbia on its prow between a soldier
 * and a sailor, with three sea horses surging ahead of it, towards the Capitol.
 */
function littlefield(ms: Mesher, ground: HeightField) {
  const [x, z] = project(...LITTLEFIELD_FOUNTAIN);
  // Level on the slope: the base under the lowest ground, the water above the highest.
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const y = groundY(ground, x + Math.cos(a) * 16 * M, z + Math.sin(a) * 16 * M);
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  // Down the Mall's axis (from the Tower): the way the ship sails.
  const [tx, tz] = project(-97.73943, 30.28619);
  const f = frame(x, lo - 0.0003, z, Math.atan2(x - tx, z - tz));
  const w = (hi - lo) / V + 0.8; // water level, metres above the base
  ms.add(cyl(16.4, 16.8, w - 0.3, 0, 40), LIMESTONE_SHADE, f); // the paved surround
  ms.add(rim(14.4, 15.6, w + 0.55, 0), LIMESTONE, f);
  ms.add(cyl(14.4, 14.4, w, 0, 40), FOUNTAIN, f);
  // The island: two steps, then the bronze group facing along +z.
  ms.add(cyl(6.2, 6.6, w + 0.5, 0, 24), LIMESTONE_SHADE, f);
  ms.add(cyl(4.4, 4.8, w + 1.3, 0, 20), LIMESTONE, f);
  const top = w + 1.3;
  ms.add(box(2.6, 2.2, 6.4, 0, top, -0.6), BRONZE, f); // hull
  const prow = new THREE.ConeGeometry(1.5, 3.2, 4, 1);
  prow.rotateX(Math.PI / 2);
  prow.scale(0.9, 0.75, 1);
  prow.translate(0, top + 1.2, 4.2);
  ms.add(prow, BRONZE, f);
  ms.add(cyl(0.45, 0.6, 3.4, top + 2.2, 8, 0, 3.2), BRONZE, f); // Columbia
  for (const s of [-1, 1]) {
    const wing = box(0.25, 2.6, 1.6, 0, 0, 0);
    wing.rotateZ(s * 0.45);
    wing.translate(s * 0.9, top + 4.4, 2.9);
    ms.add(wing, BRONZE, f);
    ms.add(cyl(0.35, 0.45, 2.3, top + 2.2, 8, s * 1.6, 0.4), BRONZE, f); // soldier, sailor
  }
  // Three sea horses ahead of the ship, rearing out of the water.
  for (const a of [-0.55, 0, 0.55]) {
    const hx = Math.sin(a) * 9;
    const hz = Math.cos(a) * 9;
    ms.add(box(1.1, 1.3, 2.6, hx, w - 0.2, hz), BRONZE, f);
    ms.add(box(0.8, 1.6, 0.8, hx, w + 0.9, hz + 1), BRONZE, f);
  }
}

// ---------------------------------------------------------------- moonlight towers

/**
 * The moonlight towers: 50 m (165 ft) triangular lattice masts, each crowned by a ring of six
 * lamps. Lattice as lines; the lamps glow cool white at night.
 */
function moonlightTowers(c: Central, ground: HeightField, lines: number[], lcol: number[], lamps: Mesher, glow: number[]) {
  const H = 50.3;
  const levels = 14;
  const grey = new THREE.Color("#4f4b47");
  const seg = (p: number[], q: number[]) => {
    lines.push(...p, ...q);
    lcol.push(grey.r, grey.g, grey.b, grey.r, grey.g, grey.b);
  };
  for (const [x, z] of c.moonlight) {
    const yb = groundY(ground, x, z) - 0.0004;
    const pt = (l: number, k: number) => {
      const t = l / levels;
      const r = 1.9 + (0.75 - 1.9) * t;
      const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
      return [x + Math.cos(a) * r * M, yb + t * H * V, z + Math.sin(a) * r * M];
    };
    for (let l = 0; l < levels; l++) {
      for (let k = 0; k < 3; k++) {
        const k2 = (k + 1) % 3;
        seg(pt(l, k), pt(l + 1, k));
        seg(pt(l + 1, k), pt(l + 1, k2));
        if (l % 2) seg(pt(l, k), pt(l + 1, k2));
        else seg(pt(l, k2), pt(l + 1, k));
      }
    }
    const top = yb + H * V;
    const hex = (i: number) => {
      const a = (i / 6) * Math.PI * 2;
      return [x + Math.cos(a) * 2.6 * M, top, z + Math.sin(a) * 2.6 * M];
    };
    for (let i = 0; i < 6; i++) {
      seg([x, top, z], hex(i));
      seg(hex(i), hex((i + 1) % 6));
      const [lx, , lz] = hex(i);
      lamps.add(box(0.9, 1.5, 0.9, 0, -1.5, 0), "#e9ecef", frame(lx, top, lz));
    }
    lamps.add(cyl(0.2, 1.4, 1.2, 0, 6), "#6b6661", frame(x, top, z)); // the little hood
    glow.push(x, top - 0.8 * V, z);
  }
}

// ---------------------------------------------------------------- Mount Bonnell

/** The stone pavilion on Mount Bonnell's summit, 240 m above Lake Austin's first bend. */
function bonnell(ms: Mesher, ground: HeightField) {
  const [bx, bz] = project(-97.77325, 30.32161);
  const f = frame(bx, groundY(ground, bx, bz) - 0.0006, bz);
  ms.add(box(8, 1.2, 8, 0, 0, 0), LIMESTONE_SHADE, f);
  for (const [x, z] of [
    [-3, -3],
    [3, -3],
    [-3, 3],
    [3, 3],
  ]) {
    ms.add(box(0.8, 3.4, 0.8, x, 1.2, z), LIMESTONE, f);
  }
  ms.add(box(8.6, 0.7, 8.6, 0, 4.6, 0), LIMESTONE, f);
}

// ---------------------------------------------------------------- the Pennybacker Bridge

/**
 * The Percy V. Pennybacker Jr. Bridge (1982) carries Loop 360 across Lake Austin on a
 * weathering-steel through arch: the ribs spring from the bluffs below the deck and rise above
 * it, with the deck hung from the crown and propped near the ends.
 */
function pennybacker(ms: Mesher, lines: number[], lcol: number[], ground: HeightField) {
  // Where Loop 360 crosses the water.
  const [ax, az] = project(-97.7966, 30.35057);
  const [bx, bz] = project(-97.79743, 30.34923);
  const cx = (ax + bx) / 2;
  const cz = (az + bz) / 2;
  let dx = bx - ax;
  let dz = bz - az;
  const dl = Math.hypot(dx, dz);
  dx /= dl;
  dz /= dl;
  const nx = -dz;
  const nz = dx;
  const L = 0.36; // deck length, km
  const S = 0.183; // arch span, km (600 ft)
  const yW = groundY(ground, cx, cz);
  const e0 = groundY(ground, cx - (dx * L) / 2, cz - (dz * L) / 2);
  const e1 = groundY(ground, cx + (dx * L) / 2, cz + (dz * L) / 2);
  // The regional terrain softens the bluffs unevenly, so the deck runs bank to bank and the
  // arch carries the drama: it springs near the water and rises well above the road.
  const yA = Math.max(e0, yW + 0.02) + 0.003;
  const yB = Math.max(e1, yW + 0.02) + 0.003;
  const deckY = (s: number) => yA + (yB - yA) * (s / L + 0.5);
  const ySpring = yW + 0.006;
  const yCrown = deckY(0) + Math.max(0.035, (deckY(0) - ySpring) * 0.6);
  const at = (s: number, lat: number, y: number) => [cx + dx * s + nx * lat, y, cz + dz * s + nz * lat];
  const steel = new THREE.Color(STEEL);
  const conc = new THREE.Color(CONCRETE);

  // Deck: a slab with its edges, and piers where it meets the bluffs.
  const hw = 0.0105;
  const th = 0.0025;
  const n = 18;
  for (let i = 0; i < n; i++) {
    const s0 = -L / 2 + (L * i) / n;
    const s1 = -L / 2 + (L * (i + 1)) / n;
    const y0 = deckY(s0);
    const y1 = deckY(s1);
    ms.quad(at(s0, -hw, y0), at(s1, -hw, y1), at(s1, hw, y1), at(s0, hw, y0), conc);
    ms.quad(at(s0, -hw, y0 - th), at(s1, -hw, y1 - th), at(s1, -hw, y1), at(s0, -hw, y0), conc);
    ms.quad(at(s0, hw, y0), at(s1, hw, y1), at(s1, hw, y1 - th), at(s0, hw, y0 - th), conc);
  }
  for (const s of [-L / 2, L / 2]) {
    const g = groundY(ground, cx + dx * s, cz + dz * s) - 0.003;
    const top = deckY(s) - th;
    if (g < top) {
      for (const lat of [-hw * 0.6, hw * 0.6]) {
        const w = 0.002;
        ms.quad(at(s - w, lat, g), at(s + w, lat, g), at(s + w, lat, top), at(s - w, lat, top), conc);
      }
    }
  }

  // Two arch ribs just outside the deck: a parabola from the springs to the crown.
  const ribY = (s: number) => yCrown - (yCrown - ySpring) * (2 * s / S) ** 2;
  const rw = 0.0018; // half width, km
  const rh = 0.0035; // half depth, km
  const steps = 28;
  for (const side of [-1, 1]) {
    const lat = side * (hw + 0.002);
    for (let i = 0; i < steps; i++) {
      const s0 = -S / 2 + (S * i) / steps;
      const s1 = -S / 2 + (S * (i + 1)) / steps;
      const y0 = ribY(s0);
      const y1 = ribY(s1);
      const A = (s: number, y: number, l: number, h: number) => at(s, lat + l, y + h);
      ms.quad(A(s0, y0, -rw, rh), A(s1, y1, -rw, rh), A(s1, y1, rw, rh), A(s0, y0, rw, rh), steel);
      ms.quad(A(s0, y0, -rw, -rh), A(s0, y0, rw, -rh), A(s1, y1, rw, -rh), A(s1, y1, -rw, -rh), steel);
      ms.quad(A(s0, y0, -rw, -rh), A(s1, y1, -rw, -rh), A(s1, y1, -rw, rh), A(s0, y0, -rw, rh), steel);
      ms.quad(A(s0, y0, rw, rh), A(s1, y1, rw, rh), A(s1, y1, rw, -rh), A(s0, y0, rw, -rh), steel);
    }
    // Hangers above the deck, struts below it.
    const hang = new THREE.Color("#5b3524");
    for (let s = -S / 2 + 0.009; s < S / 2 - 0.004; s += 0.0115) {
      const y = ribY(s);
      const yd = deckY(s);
      if (Math.abs(y - yd) < 0.004) continue;
      lines.push(...at(s, lat, y), ...at(s, lat, yd));
      lcol.push(hang.r, hang.g, hang.b, hang.r, hang.g, hang.b);
    }
  }
  // Cross bracing between the ribs above the deck.
  for (let s = -S / 4; s <= S / 4 + 1e-6; s += S / 8) {
    const y = ribY(s);
    const lat = hw + 0.002;
    ms.quad(at(s - 0.0015, -lat, y + rh), at(s + 0.0015, -lat, y + rh), at(s + 0.0015, lat, y + rh), at(s - 0.0015, lat, y + rh), steel);
  }
}

// ---------------------------------------------------------------- towers and arenas

/**
 * Glass for modelled towers, in the buildings' own format (aInfo, aU) so they share the
 * curtain-wall shader, its sky reflections and its lit windows at night.
 */
class GlassMesher {
  private pos: number[] = [];
  private info: number[] = [];
  private u: number[] = [];

  constructor(
    private yBase: number,
    private hM: number,
    private r: number,
    /** KIND_* in extrude.ts; the style rides in r's whole part */
    private kind = KIND_PLAIN,
  ) {}

  private vtx(p: number[], u: number) {
    this.pos.push(p[0], p[1], p[2]);
    this.info.push(this.kind, this.yBase, this.hM, this.r);
    this.u.push(u);
  }

  tri(a: number[], b: number[], c: number[]) {
    this.vtx(a, 0);
    this.vtx(b, 0);
    this.vtx(c, 0);
  }

  /** A wall quad from a (u = ua) to b (u = ub), bottom y0 to top y1 at each end. */
  wall(a: number[], b: number[], ua: number, ub: number, y0: number, y1a: number, y1b = y1a) {
    const p = [a[0], y0, a[1]];
    const q = [b[0], y0, b[1]];
    const qt = [b[0], y1b, b[1]];
    const pt = [a[0], y1a, a[1]];
    this.vtx(p, ua);
    this.vtx(q, ub);
    this.vtx(qt, ub);
    this.vtx(p, ua);
    this.vtx(qt, ub);
    this.vtx(pt, ua);
  }

  /** Vertical walls around a ring (km), and a flat cap. */
  prism(ring: ArrayLike<number>, y0: number, y1: number, cap = true) {
    const n = ring.length / 2;
    let cum = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const seg = Math.hypot(ring[j * 2] - ring[i * 2], ring[j * 2 + 1] - ring[i * 2 + 1]) * 1000;
      this.wall([ring[i * 2], ring[i * 2 + 1]], [ring[j * 2], ring[j * 2 + 1]], cum, cum + seg, y0, y1);
      cum += seg;
    }
    if (!cap) return;
    const idx = earcut(Array.from(ring));
    const p = (q: number) => [ring[q * 2], y1, ring[q * 2 + 1]];
    for (let k = 0; k < idx.length; k += 3) this.tri(p(idx[k]), p(idx[k + 1]), p(idx[k + 2]));
  }

  append(to: { pos: number[]; info: number[]; u: number[] }) {
    to.pos.push(...this.pos);
    to.info.push(...this.info);
    to.u.push(...this.u);
  }
}

/** Oriented bounds of an outline: centre, long axis (unit) and half extents along and across it. */
function obb(outline: Polyline) {
  const r = ring(outline);
  const n = r.length / 2;
  let best = 0;
  let ux = 1;
  let uz = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = r[j * 2] - r[i * 2];
    const dz = r[j * 2 + 1] - r[i * 2 + 1];
    const l = Math.hypot(dx, dz);
    if (l > best) {
      best = l;
      ux = dx / l;
      uz = dz / l;
    }
  }
  let a0 = Infinity;
  let a1 = -Infinity;
  let b0 = Infinity;
  let b1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = r[i * 2] * ux + r[i * 2 + 1] * uz;
    const q = -r[i * 2] * uz + r[i * 2 + 1] * ux;
    a0 = Math.min(a0, p);
    a1 = Math.max(a1, p);
    b0 = Math.min(b0, q);
    b1 = Math.max(b1, q);
  }
  let A = (a1 - a0) / 2;
  let B = (b1 - b0) / 2;
  const cp = (a0 + a1) / 2;
  const cq = (b0 + b1) / 2;
  const cx = cp * ux - cq * uz;
  const cz = cp * uz + cq * ux;
  if (B > A) {
    [A, B] = [B, A];
    [ux, uz] = [-uz, ux];
  }
  /** World point at (p along, q across) in km from the centre. */
  const at = (p: number, q: number): [number, number] => [cx + ux * p - uz * q, cz + uz * p + ux * q];
  return { cx, cz, ux, uz, A, B, at };
}

type GlassOut = { pos: number[]; info: number[]; u: number[] };

/**
 * Frost Bank Tower (2003): blue glass rising to a faceted crown that splits into two peaks,
 * the "owl ears" of the skyline.
 */
function frostTower(glass: GlassOut, c: Central, ground: HeightField) {
  const o = c.landmarks["frost-bank-tower"];
  if (!o) return;
  const [lo] = groundRange(ground, o.outline);
  const H = (o.height ?? 157) * V;
  const gm = new GlassMesher(lo, o.height ?? 157, 0.1);
  const shaftTop = lo + H * 0.76;
  gm.prism(ring(o.outline), lo - 0.003, shaftTop, false);
  const b = obb(o.outline);
  const A = b.A * 0.97;
  const B = b.B * 0.97;
  const P = (p: number, q: number, y: number) => {
    const [x, z] = b.at(p, q);
    return [x, y, z];
  };
  const c1 = P(-A, -B, shaftTop);
  const c2 = P(A, -B, shaftTop);
  const c3 = P(A, B, shaftTop);
  const c4 = P(-A, B, shaftTop);
  const m1 = P(0, -B, shaftTop);
  const m3 = P(0, B, shaftTop);
  const top = lo + H;
  const p1 = P(-A * 0.38, 0, top);
  const p2 = P(A * 0.38, 0, top);
  const notch = P(0, 0, shaftTop + (top - shaftTop) * 0.55);
  gm.tri(c1, m1, p1);
  gm.tri(m1, c2, p2);
  gm.tri(m1, p2, notch);
  gm.tri(m1, notch, p1);
  gm.tri(c3, m3, p2);
  gm.tri(m3, c4, p1);
  gm.tri(m3, p1, notch);
  gm.tri(m3, notch, p2);
  gm.tri(c4, c1, p1);
  gm.tri(c2, c3, p2);
  // Close the shaft under the crown where the outline and the crown's rectangle differ.
  const r = ring(o.outline);
  const idx = earcut(Array.from(r));
  for (let k = 0; k < idx.length; k += 3) {
    const q = (i: number) => [r[i * 2], shaftTop, r[i * 2 + 1]];
    gm.tri(q(idx[k]), q(idx[k + 1]), q(idx[k + 2]));
  }
  gm.append(glass);
}

/**
 * The Independent (2019): 58 floors in five stacked glass blocks, each slid off the one below —
 * Austin's "Jenga tower". White slab edges mark the joints.
 */
function independent(glass: GlassOut, ms: Mesher, c: Central, ground: HeightField) {
  const o = c.landmarks["the-independent"];
  if (!o) return;
  const [lo] = groundRange(ground, o.outline);
  const hM = o.height ?? 209;
  const H = hM * V;
  const b = obb(o.outline);
  const gm = new GlassMesher(lo, hM, 0.6);
  const offsets = [0, 0.34, -0.22, 0.4, -0.12];
  const white = new THREE.Color("#f1efe9");
  for (let i = 0; i < 5; i++) {
    const d = offsets[i] * b.A;
    const q = [
      ...b.at(-b.A + d, -b.B),
      ...b.at(b.A + d, -b.B),
      ...b.at(b.A + d, b.B),
      ...b.at(-b.A + d, b.B),
    ];
    const y0 = i === 0 ? lo - 0.003 : lo + (H * i) / 5;
    const y1 = lo + (H * (i + 1)) / 5;
    gm.prism(q, y0, y1 - 0.0012, i === 4);
    // The white slab edge at the top of each block.
    const s = 1.02;
    const e = [b.at((-b.A + d) * s, -b.B * s), b.at((b.A + d) * s, -b.B * s), b.at((b.A + d) * s, b.B * s), b.at((-b.A + d) * s, b.B * s)];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = e[k];
      const [bx, bz] = e[(k + 1) % 4];
      ms.quad([ax, y1 - 0.0012, az], [bx, y1 - 0.0012, bz], [bx, y1, bz], [ax, y1, az], white);
    }
    ms.quad([e[0][0], y1, e[0][1]], [e[1][0], y1, e[1][1]], [e[2][0], y1, e[2][1]], [e[3][0], y1, e[3][1]], white);
  }
  gm.append(glass);
}

/**
 * Block 185 (2022): a glass tower whose top curves down along its length like a sail.
 */
function block185(glass: GlassOut, c: Central, ground: HeightField) {
  const o = c.landmarks["block-185"];
  if (!o) return;
  const [lo] = groundRange(ground, o.outline);
  const hM = o.height ?? 181;
  const H = hM * V;
  const gm = new GlassMesher(lo, hM, 0.35);
  const base = lo + H * 0.8;
  gm.prism(ring(o.outline), lo - 0.003, base);
  const b = obb(o.outline);
  // The sail over the tower's rectangle (inset to stay on the roof), tall at the south end.
  const A = b.A * 0.84;
  const B = b.B * 0.84;
  const southIsPlus = b.uz > 0;
  const steps = 10;
  const hAt = (t: number) => base + (H - (base - lo)) * Math.pow(1 - t, 1.6);
  const pt = (t: number, q: number, y: number) => {
    const p = (southIsPlus ? 1 : -1) * (A - 2 * A * t);
    const [x, z] = b.at(p, q);
    return [x, y, z];
  };
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const y0 = hAt(t0);
    const y1 = hAt(t1);
    const u0 = t0 * 2 * A * 1000;
    const u1 = t1 * 2 * A * 1000;
    for (const q of [-B, B]) {
      const a = pt(t0, q, 0);
      const d = pt(t1, q, 0);
      gm.wall([a[0], a[2]], [d[0], d[2]], u0, u1, base, y0, y1);
    }
    // The curved top.
    gm.tri(pt(t0, -B, y0), pt(t1, -B, y1), pt(t1, B, y1));
    gm.tri(pt(t0, -B, y0), pt(t1, B, y1), pt(t0, B, y0));
  }
  const e0 = pt(0, -B, 0);
  const e1 = pt(0, B, 0);
  gm.wall([e0[0], e0[2]], [e1[0], e1[2]], 0, 2 * B * 1000, base, hAt(0));
  gm.append(glass);
}

/** Where a ray from (cx, cz) along (dx, dz) leaves a ring, as a distance (km). */
function rayExit(r: Float32Array, cx: number, cz: number, dx: number, dz: number): number {
  const n = r.length / 2;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r[i * 2] - cx;
    const az = r[i * 2 + 1] - cz;
    const ex = r[j * 2] - r[i * 2];
    const ez = r[j * 2 + 1] - r[i * 2 + 1];
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (ax * ez - az * ex) / den;
    const s = (ax * dz - az * dx) / den;
    if (t > 0 && s >= 0 && s <= 1) best = Math.min(best, t);
  }
  return best;
}

/**
 * Darrell K Royal–Texas Memorial Stadium: a north–south field with burnt-orange end zones, a
 * lower bowl all round, a ring of suites, upper decks on the west (tallest, under the glass press
 * box) and east and over the south end zone, the north end-zone building, the video board over
 * the south stands, and LED light bars along the rims. Built around the footprint's middle and
 * kept inside it.
 */
function stadium(ms: Mesher, stands: Mesher, field: Mesher, lamps: Mesher, c: Central, ground: HeightField) {
  const o = c.landmarks["dkr-stadium"];
  if (!o) return;
  const r = ring(o.outline);
  const [lo] = groundRange(ground, o.outline);
  let bx0 = Infinity;
  let bx1 = -Infinity;
  let bz0 = Infinity;
  let bz1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    bx0 = Math.min(bx0, r[i]);
    bx1 = Math.max(bx1, r[i]);
    bz0 = Math.min(bz0, r[i + 1]);
    bz1 = Math.max(bz1, r[i + 1]);
  }
  const cx = (bx0 + bx1) / 2;
  const cz = (bz0 + bz1) / 2;
  // The bowl is cut into a slope: the field sits at the highest ground under it.
  let yc = lo;
  for (const [fx, fz] of [
    [0, 0],
    [-0.03, -0.06],
    [0.03, -0.06],
    [0.03, 0.06],
    [-0.03, 0.06],
  ]) {
    yc = Math.max(yc, groundY(ground, cx + fx, cz + fz));
  }
  const y = yc + 0.0005;
  const C = (hex: string) => new THREE.Color(hex);
  const orange = C("#bf5700");
  const orange2 = C("#cc6a1e");
  const aisle = C("#a39d93");
  const turf = C("#3e7a37");
  const white = C("#f4f4ef");
  const wall = C("#4f5a54");
  const walk = C("#8c877f");
  const suites = C("#2f3a46");
  const stone = C("#d8ccb4");
  const brick = C("#c3ab8b");
  const P = (x: number, z: number, yy: number) => [cx + x, yy, cz + z];

  // Field: turf, the sidelines, end zones in burnt orange, a line every five yards, and the
  // longhorn circle at midfield.
  field.quad(P(-0.032, -0.062, y), P(0.032, -0.062, y), P(0.032, 0.062, y), P(-0.032, 0.062, y), turf);
  const W = 0.0244;
  const Lf = 0.0549;
  for (const sg of [-1, 1]) {
    field.quad(P(-W, sg * 0.0457, y + 0.0002), P(W, sg * 0.0457, y + 0.0002), P(W, sg * Lf, y + 0.0002), P(-W, sg * Lf, y + 0.0002), orange);
    field.quad(P(sg * W - 0.0004, -Lf, y + 0.0002), P(sg * W + 0.0004, -Lf, y + 0.0002), P(sg * W + 0.0004, Lf, y + 0.0002), P(sg * W - 0.0004, Lf, y + 0.0002), white);
  }
  for (let k = -9; k <= 9; k++) {
    const z = k * 0.00457;
    const t = k % 2 === 0 ? 0.0003 : 0.00015;
    field.quad(P(-W, z - t, y + 0.0003), P(W, z - t, y + 0.0003), P(W, z + t, y + 0.0003), P(-W, z + t, y + 0.0003), white);
  }
  const logo = new THREE.CylinderGeometry(4.6, 4.6, 0.3, 24);
  logo.translate(0, 0.25, 0);
  field.add(logo, "#bf5700", frame(cx, y, cz));

  // The stands, lofted around a rounded rectangle just outside the field: at each point round
  // it, a section out from the field wall, its depths and heights blended by which side it faces.
  const AX = 0.032;
  const AZ = 0.062;
  const N = 88;
  type Sec = { px: number; pz: number; nx: number; nz: number; pts: number[][] };
  const secs: Sec[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // A superellipse (p = 4): straight sides with rounded corners.
    const px = AX * Math.sign(ca) * Math.abs(ca) ** 0.5;
    const pz = AZ * Math.sign(sa) * Math.abs(sa) ** 0.5;
    let nx = (Math.sign(px) * Math.abs(px / AX) ** 3) / AX;
    let nz = (Math.sign(pz) * Math.abs(pz / AZ) ** 3) / AZ;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    const we = Math.max(0, nx) ** 2;
    const ww = Math.max(0, -nx) ** 2;
    const wn = Math.max(0, -nz) ** 2;
    const ws = Math.max(0, nz) ** 2;
    const sum = we + ww + wn + ws;
    const mix = (e: number, w: number, n: number, s: number) => (e * we + w * ww + n * wn + s * ws) / sum;
    const room = (rayExit(r, cx + px, cz + pz, nx, nz) - 0.004) * 1000;
    const dLow = Math.min(mix(40, 40, 26, 28), room - 12);
    const hLow = mix(19, 19, 14, 15);
    const up = mix(1, 1, 0, 0.85);
    const dUp = Math.max(dLow + 8, Math.min(mix(74, 80, 30, 46), room - 3));
    const hUp = mix(40, 44, hLow + 3, 30);
    const at = (d: number, h: number) => [cx + px + nx * d * M, h, cz + pz + nz * d * M];
    const Y = (h: number) => yc + h * V;
    secs.push({
      px,
      pz,
      nx,
      nz,
      pts: [
        at(0, y),
        at(0, Y(2.2)),
        at(1.5, Y(2.6)),
        at(dLow * 0.25, Y(2.6 + (hLow - 2.6) * 0.25)),
        at(dLow * 0.5, Y(2.6 + (hLow - 2.6) * 0.5)),
        at(dLow * 0.75, Y(2.6 + (hLow - 2.6) * 0.75)),
        at(dLow, Y(hLow)),
        at(dLow + 4, Y(hLow)),
        at(dLow + 4, Y(hLow + 6.5 * up)),
        at(dLow + 4 + (dUp - dLow - 4) * 0.33, Y(hLow + 6.5 * up + (hUp - hLow - 6.5 * up) * 0.33)),
        at(dLow + 4 + (dUp - dLow - 4) * 0.66, Y(hLow + 6.5 * up + (hUp - hLow - 6.5 * up) * 0.66)),
        at(dUp, Y(hUp)),
        at(dUp, Y(hUp + 2.5)),
        at(dUp + 1.5, Y(hUp + 2.5)),
        at(dUp + 1.5, Y(hUp * 0.8)),
        at(dUp + 1.5, Y(hUp * 0.66)),
        at(dUp + 1.5, Y(hUp * 0.4)),
        at(dUp + 1.5, lo - 0.003),
      ],
    });
  }
  // Colours for the bands of each section, field wall to facade.
  const bands = (i: number): THREE.Color[] => {
    const isle = i % 6 === 0;
    const seat = (k: number) => (isle ? aisle : k % 2 ? orange2 : orange);
    return [wall, walk, seat(0), seat(1), seat(2), seat(3), walk, suites, seat(0), seat(1), seat(2), stone, stone, stone, suites, stone, brick];
  };
  // The seats go on their own mesh: under the lights after dark, they glow.
  const SEATS = new Set([2, 3, 4, 5, 8, 9, 10]);
  for (let i = 0; i < N; i++) {
    const A = secs[i].pts;
    const B = secs[(i + 1) % N].pts;
    const cols = bands(i);
    for (let k = 0; k + 1 < A.length; k++) (SEATS.has(k) ? stands : ms).quad(A[k], B[k], B[k + 1], A[k + 1], cols[k]);
  }

  // The press box over the west stands, and light bars along both rims.
  const west = secs.reduce((a, b) => (b.nx < a.nx ? b : a));
  const wTop = west.pts[12][1];
  const wx = west.pts[11][0] - cx + 0.004;
  const pressBox = frame(cx + wx, wTop, cz);
  ms.add(box(10, 12, 104, 0, 0, 0), "#2f3a46", pressBox);
  ms.add(box(11.5, 1.2, 106, 0, 12, 0), "#d8ccb4", pressBox);
  for (let z = -48; z <= 48; z += 8) lamps.add(box(3, 1.4, 5, 0, 13.2, z), "#e9ecef", pressBox);
  const east = secs.reduce((a, b) => (b.nx > a.nx ? b : a));
  const eTop = east.pts[12][1];
  const ex = east.pts[11][0] - cx;
  for (let z = -44; z <= 44; z += 8) lamps.add(box(3, 1.4, 5, 0, 0, z), "#e9ecef", frame(cx + ex, eTop, cz));

  // The video board over the south stands, facing the field.
  const south = secs.reduce((a, b) => (b.nz > a.nz ? b : a));
  const sz = south.pts[11][2] - cz - 0.006;
  const board = frame(cx, yc, cz + sz);
  for (const lx of [-14, 14]) ms.add(box(2, 34, 2, lx, 0, 1.5), "#6d6a66", board);
  ms.add(box(42, 18, 2.4, 0, 33, 1.5), "#23272c", board);
  lamps.add(box(38, 14.5, 0.3, 0, 34.8, 0.2), "#3a4048", board);

  // The north end zone: the athletics building closing the bowl, glass towards the field.
  const north = secs.reduce((a, b) => (b.nz < a.nz ? b : a));
  const nz = north.pts[11][2] - cz;
  const nb = frame(cx, lo - 0.003, cz + nz - 0.011);
  ms.add(box(96, (y - lo) / V + 27, 20, 0, 0, 0), "#d2c5ad", nb);
  ms.add(box(90, 12, 0.6, 0, (y - lo) / V + 12, 10.2), "#2f3a46", nb);
}

/** Moody Center (2022): the university's arena, a glass-and-metal drum under a pale domed roof. */
function moody(ms: Mesher, c: Central, ground: HeightField) {
  const o = c.landmarks["moody-center"];
  if (!o) return;
  const r = ring(o.outline);
  const [lo] = groundRange(ground, o.outline);
  const n = r.length / 2;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    cx += r[i * 2];
    cz += r[i * 2 + 1];
  }
  cx /= n;
  cz /= n;
  const eave = lo + 20 * V;
  const mid = lo + 26 * V;
  const crown = lo + 28.5 * V;
  const wall = new THREE.Color("#5f6975");
  const roof = new THREE.Color("#ecebe6");
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = [r[i * 2], r[i * 2 + 1]];
    const b = [r[j * 2], r[j * 2 + 1]];
    ms.quad([a[0], lo - 0.003, a[1]], [b[0], lo - 0.003, b[1]], [b[0], eave, b[1]], [a[0], eave, a[1]], wall);
    const am = [cx + (a[0] - cx) * 0.6, mid, cz + (a[1] - cz) * 0.6];
    const bm = [cx + (b[0] - cx) * 0.6, mid, cz + (b[1] - cz) * 0.6];
    ms.quad([a[0], eave, a[1]], [b[0], eave, b[1]], bm, am, roof);
    ms.tri(am, bm, [cx, crown, cz], roof);
  }
}

/**
 * Tom Miller Dam (1940), where Lake Austin steps down into Lady Bird Lake: a granite wall
 * across the river with a sloped spillway face and a row of gate piers on its crest.
 */
function tomMillerDam(ms: Mesher, c: Central, ground: HeightField) {
  const r = c.rivers.ladybird;
  if (!r || r.line.length < 12) return;
  const l = r.line;
  const x0 = l[0];
  const z0 = l[1];
  let dx = l[10] - x0;
  let dz = l[11] - z0;
  const dl = Math.hypot(dx, dz);
  dx /= dl;
  dz /= dl;
  const nx = -dz;
  const nz = dx;
  const w = r.half[0] + 0.04;
  const yUp = groundY(ground, x0 - dx * 0.04, z0 - dz * 0.04);
  const yDown = groundY(ground, x0 + dx * 0.04, z0 + dz * 0.04);
  const yTop = Math.max(yUp, yDown) + 0.006;
  const yBot = Math.min(yUp, yDown) - 0.003;
  const P = (s: number, q: number, y: number) => [x0 + dx * s + nx * q, y, z0 + dz * s + nz * q];
  const granite = new THREE.Color("#c3b8a8");
  const face = new THREE.Color("#d6cdbf");
  const pier = new THREE.Color("#9d9285");
  const up = -0.004;
  const crest = 0.006;
  const toe = 0.03;
  // Upstream face, crest, spillway, and the ends.
  ms.quad(P(up, -w, yBot), P(up, w, yBot), P(up, w, yTop), P(up, -w, yTop), granite);
  ms.quad(P(up, -w, yTop), P(up, w, yTop), P(crest, w, yTop), P(crest, -w, yTop), granite);
  ms.quad(P(crest, -w, yTop), P(crest, w, yTop), P(toe, w, yBot), P(toe, -w, yBot), face);
  for (const q of [-w, w]) {
    ms.tri(P(up, q, yBot), P(up, q, yTop), P(crest, q, yTop), granite);
    ms.tri(P(up, q, yBot), P(crest, q, yTop), P(toe, q, yBot), granite);
  }
  // Gate piers along the crest.
  const ph = 0.0045;
  for (let q = -w + 0.012; q < w - 0.006; q += 0.016) {
    const a = 0.0012;
    const b0 = P(up, q - a, yTop);
    const b1 = P(up, q + a, yTop);
    const b2 = P(crest + 0.004, q + a, yTop);
    const b3 = P(crest + 0.004, q - a, yTop);
    const t = (p: number[]) => [p[0], p[1] + ph, p[2]];
    ms.quad(b0, b1, t(b1), t(b0), pier);
    ms.quad(b1, b2, t(b2), t(b1), pier);
    ms.quad(b2, b3, t(b3), t(b2), pier);
    ms.quad(b3, b0, t(b0), t(b3), pier);
    ms.quad(t(b0), t(b1), t(b2), t(b3), pier);
  }
}

/**
 * Longhorn Dam (1960), which holds Lady Bird Lake at its east end: Pleasant Valley Road runs
 * along its crest over a row of spillway gates.
 */
function longhornDam(ms: Mesher, ground: HeightField) {
  // Pleasant Valley Road's crossing; the river leaves the lake eastward here.
  const [ax, az] = project(-97.71343, 30.25107);
  const [bx, bz] = project(-97.71357, 30.24964);
  let tx = bx - ax;
  let tz = bz - az;
  const L = Math.hypot(tx, tz);
  tx /= L;
  tz /= L;
  let dx = -tz;
  let dz = tx;
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  if (dx < 0) {
    dx = -dx;
    dz = -dz;
  }
  const off = 0;
  const P = (s: number, q: number, y: number) => [mx + dx * (off + q) + tx * s, y, mz + dz * (off + q) + tz * s];
  const half = L / 2 + 0.01;
  const water = groundY(ground, mx + dx * off, mz + dz * off);
  const end = (s: number) => {
    const [x, , z] = P(s, 0, 0);
    return groundY(ground, x, z);
  };
  const deckY = Math.max(end(-half), end(half), water + 0.012);
  const conc = new THREE.Color("#cfc8bb");
  const gate = new THREE.Color("#8d8a84");
  const foam = new THREE.Color("#e2eeee");
  // Deck.
  ms.quad(P(-half, -0.004, deckY), P(half, -0.004, deckY), P(half, 0.006, deckY), P(-half, 0.006, deckY), conc);
  ms.quad(P(-half, 0.006, deckY), P(half, 0.006, deckY), P(half, 0.006, deckY - 0.0018), P(-half, 0.006, deckY - 0.0018), conc);
  // Piers, with a gate between each pair, and the spillway apron below.
  const step = 0.012;
  for (let s = -half + 0.004; s < half - 0.002; s += step) {
    const w = 0.0008;
    const y0 = water - 0.003;
    const y1 = deckY - 0.0018;
    ms.quad(P(s - w, 0.006, y0), P(s + w, 0.006, y0), P(s + w, 0.006, y1), P(s - w, 0.006, y1), conc);
    ms.quad(P(s - w, -0.004, y0), P(s - w, 0.006, y0), P(s - w, 0.006, y1), P(s - w, -0.004, y1), conc);
    ms.quad(P(s + w, 0.006, y0), P(s + w, -0.004, y0), P(s + w, -0.004, y1), P(s + w, 0.006, y1), conc);
    if (s + step < half - 0.002) {
      ms.quad(P(s + w, 0.003, water + 0.0012), P(s + step - w, 0.003, water + 0.0012), P(s + step - w, 0.003, y1), P(s + w, 0.003, y1), gate);
    }
  }
  // White water on the tailwater below the gates.
  const tail = groundY(ground, mx + dx * 0.02, mz + dz * 0.02) + 0.0005;
  ms.quad(P(-half, 0.006, tail), P(half, 0.006, tail), P(half, 0.02, tail), P(-half, 0.02, tail), foam);
}

// ---------------------------------------------------------------- assembly

interface Parts {
  stone: THREE.MeshLambertMaterial;
  /** the stadium and the arena: not floodlit whole, as the stone is */
  arena: THREE.MeshLambertMaterial;
  /** the field, under the stadium's lights after dark */
  field: THREE.MeshLambertMaterial;
  /** the stadium's seats, under its lights */
  stands: THREE.MeshLambertMaterial;
  soft: THREE.MeshLambertMaterial;
  hot: THREE.MeshLambertMaterial;
  lamps: THREE.MeshLambertMaterial;
  /** the Capitol's dome, floodlit brightest */
  lit: THREE.MeshLambertMaterial;
  /** lamp heads and skylights, warm after dark */
  warm: THREE.MeshLambertMaterial;
  /** paving and ironwork: not floodlit */
  pave: THREE.MeshLambertMaterial;
  glow: THREE.PointsMaterial;
  glowPoints: THREE.Points;
  warmGlow: THREE.PointsMaterial;
  warmPoints: THREE.Points;
}

function glowTexture(): THREE.Texture {
  const t = radialTexture(64, [
    [0, 255, 255, 255, 1],
    [0.18, 235, 242, 255, 0.85],
    [0.45, 200, 215, 255, 0.25],
    [1, 200, 215, 255, 0],
  ]);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function build(c: Central, ground: HeightField): { root: THREE.Group; glass: THREE.BufferGeometry } {
  const stone = new Mesher();
  const glassOut: GlassOut = { pos: [], info: [], u: [] };
  const soft = new Mesher();
  const hot = new Mesher();
  const lamps = new Mesher();
  const arena = new Mesher();
  const field = new Mesher();
  const stands = new Mesher();
  const lit = new Mesher();
  const warm = new Mesher();
  const pave = new Mesher();
  const lines: number[] = [];
  const lcol: number[] = [];
  const glow: number[] = [];
  const warmGlow: number[] = [];

  capitol(stone, lit, warm, glassOut, c, ground);
  capitolGrounds(stone, pave, warm, warmGlow, ground);
  governorsMansion(stone, c, ground);
  landOffice(stone, c, ground);
  stMary(stone, c, ground);
  utTower(stone, soft, hot, glassOut, c, ground);
  littlefield(stone, ground);
  moonlightTowers(c, ground, lines, lcol, lamps, glow);
  bonnell(stone, ground);
  pennybacker(stone, lines, lcol, ground);
  frostTower(glassOut, c, ground);
  independent(glassOut, stone, c, ground);
  block185(glassOut, c, ground);
  stadium(arena, stands, field, lamps, c, ground);
  moody(arena, c, ground);
  tomMillerDam(stone, c, ground);
  longhornDam(stone, ground);

  const mat = () => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const parts: Parts = {
    stone: mat(),
    arena: mat(),
    field: mat(),
    stands: mat(),
    soft: mat(),
    hot: mat(),
    lamps: mat(),
    lit: mat(),
    warm: mat(),
    pave: mat(),
    glow: new THREE.PointsMaterial({
      map: glowTexture(),
      color: "#e4ecff",
      size: 30,
      sizeAttenuation: false,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    glowPoints: new THREE.Points(),
    warmGlow: new THREE.PointsMaterial({
      map: glowTexture(),
      color: "#ffcf8f",
      size: 12,
      sizeAttenuation: false,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    warmPoints: new THREE.Points(),
  };
  const root = new THREE.Group();
  const solid = (ms: Mesher, m: THREE.Material) => {
    const mesh = new THREE.Mesh(ms.geometry(), m);
    mesh.castShadow = mesh.receiveShadow = true;
    aoCaster(mesh);
    root.add(mesh);
  };
  solid(stone, parts.stone);
  solid(arena, parts.arena);
  solid(field, parts.field);
  solid(stands, parts.stands);
  solid(soft, parts.soft);
  solid(hot, parts.hot);
  solid(lamps, parts.lamps);
  solid(lit, parts.lit);
  solid(warm, parts.warm);
  solid(pave, parts.pave);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
  lg.setAttribute("color", new THREE.Float32BufferAttribute(lcol, 3));
  root.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })));
  const gg = new THREE.BufferGeometry();
  gg.setAttribute("position", new THREE.Float32BufferAttribute(glow, 3));
  parts.glowPoints = new THREE.Points(gg, parts.glow);
  parts.glowPoints.renderOrder = 2;
  // Clear of the ground in front of each tower (its lamps stand 80 m up).
  pullTowardCamera(parts.glow, 0.2);
  root.add(parts.glowPoints);
  const wg = new THREE.BufferGeometry();
  wg.setAttribute("position", new THREE.Float32BufferAttribute(warmGlow, 3));
  parts.warmPoints = new THREE.Points(wg, parts.warmGlow);
  parts.warmPoints.renderOrder = 2;
  pullTowardCamera(parts.warmGlow, 0.05);
  root.add(parts.warmPoints);
  root.userData.parts = parts;
  const glass = new THREE.BufferGeometry();
  glass.setAttribute("position", new THREE.Float32BufferAttribute(glassOut.pos, 3));
  glass.setAttribute("aInfo", new THREE.Float32BufferAttribute(glassOut.info, 4));
  glass.setAttribute("aU", new THREE.Float32BufferAttribute(glassOut.u, 1));
  glass.computeBoundingSphere();
  return { root, glass };
}

export default function Landmarks({ central, ground }: { central: Central; ground: HeightField }) {
  const ref = useRef<THREE.Group>(null);
  const { root, glass } = useMemo(() => build(central, ground), [central, ground]);

  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const n = sky.uNight.value;
    const p = g.userData.parts as Parts;
    // Floodlit stone, the Tower in burnt orange, and the moonlight towers' lamps.
    p.stone.emissive.setRGB(0.24, 0.18, 0.13).multiplyScalar(n);
    // Under the stadium's lights: the field bright, the seats glowing burnt orange, the rest of
    // the structure (and the arena) only just catching the light.
    p.arena.emissive.setRGB(0.012, 0.01, 0.008).multiplyScalar(n);
    p.stands.emissive.setRGB(0.06, 0.022, 0.004).multiplyScalar(n);
    p.field.emissive.setRGB(0.2, 0.36, 0.18).multiplyScalar(n);
    p.soft.emissive.setRGB(0.78, 0.3, 0.04).multiplyScalar(n * 0.7);
    p.hot.emissive.setRGB(1, 0.46, 0.08).multiplyScalar(n);
    p.lamps.emissive.setRGB(0.85, 0.9, 1).multiplyScalar(n);
    // The Capitol's dome glows above its floodlit granite; lamps and skylights warm.
    p.lit.emissive.setRGB(0.64, 0.46, 0.3).multiplyScalar(n);
    p.warm.emissive.setRGB(0.95, 0.74, 0.45).multiplyScalar(n);
    p.pave.emissive.setRGB(0.02, 0.017, 0.013).multiplyScalar(n);
    // Glows in screen pixels (three scales them by the pixel ratio), smaller as the view pulls
    // back: a moonlight tower is one lamp among the city's, not a beacon, from across town.
    const far = Math.pow(Math.max(runtime.cam.dist, 0.1), 0.75);
    p.glow.size = THREE.MathUtils.clamp(48 / far, 6, 30);
    p.warmGlow.size = THREE.MathUtils.clamp(19 / far, 3, 12);
    p.glow.opacity = Math.min(1, n * 1.3);
    p.glowPoints.visible = n > 0.03;
    p.warmGlow.opacity = Math.min(1, n * 1.3);
    p.warmPoints.visible = n > 0.03;
  });

  return (
    <>
      <primitive ref={ref} object={root} />
      <Buildings geometry={glass} />
    </>
  );
}
