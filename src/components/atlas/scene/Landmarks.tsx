"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import earcut from "earcut";
import type { Polyline } from "@/lib/atlas/assets";
import type { Central } from "@/lib/atlas/central";
import { BUILDING_EXAG, groundY, project, type HeightField } from "@/lib/atlas/geo";
import { sky } from "@/lib/atlas/timeOfDay";
import Buildings from "./Buildings";

// Austin's landmarks as procedural low-poly models: the Texas State Capitol in sunset-red
// granite, the UT Tower (lit burnt orange at night), the moonlight towers, the pavilion on
// Mount Bonnell and the Pennybacker Bridge's steel arch over Lake Austin. Heights get the
// buildings' vertical boost so the skyline keeps its proportions.

const M = 0.001; // metres -> km
const V = M * BUILDING_EXAG; // vertical metres -> km, boosted like the buildings
const UP = new THREE.Vector3(0, 1, 0);

const GRANITE = "#c58e79";
const GRANITE_LIGHT = "#d6a994";
const GRANITE_ROOF = "#9f6b5a";
const DOME = "#dcbfa9";
const STATUE = "#6f6a5c";
const LIMESTONE = "#e6dac3";
const LIMESTONE_SHADE = "#cdbfa6";
const TILE = "#b35a3c";
const CLOCK = "#3d352c";
const STEEL = "#8c4a2b";
const CONCRETE = "#cfc8bc";

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

/**
 * The Texas State Capitol (1888): a cross-shaped granite block, the south portico facing
 * Congress Avenue, and the rotunda's drum, colonnade, dome and lantern under the Goddess of
 * Liberty, 92 m to the top of her star.
 */
function capitol(ms: Mesher, c: Central, ground: HeightField) {
  const outline = c.landmarks.capitol?.outline;
  const [px, pz] = project(-97.74035, 30.27472);
  const [lo, hi] = outline ? groundRange(ground, outline) : [groundY(ground, px, pz), groundY(ground, px, pz)];
  const roofM = 26;
  const roofY = hi + roofM * V;
  if (outline) extrude(ms, outline, lo - 0.003, roofY, GRANITE, GRANITE_ROOF);
  const f = frame(px, roofY, pz);

  // The south portico, on the facade where the centre line meets the outline.
  let south = pz + 0.045;
  if (outline) {
    const r = ring(outline);
    const n = r.length / 2;
    let best = -Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = r[i * 2];
      const x1 = r[j * 2];
      if ((x0 - px) * (x1 - px) > 0 || x0 === x1) continue;
      const t = (px - x0) / (x1 - x0);
      best = Math.max(best, r[i * 2 + 1] + (r[j * 2 + 1] - r[i * 2 + 1]) * t);
    }
    if (Number.isFinite(best)) south = best;
  }
  const sz = (south - pz) / M; // metres south of the rotunda
  const baseM = (groundY(ground, px, south + 0.008) - roofY) / V; // ground below the roof, metres
  ms.add(box(30, -baseM, 9, 0, baseM, sz + 4.5), GRANITE_LIGHT, f);
  for (let i = 0; i < 6; i++) ms.add(box(1.3, -baseM, 1.3, -12.5 + i * 5, baseM, sz + 9.6), GRANITE_LIGHT, f);
  ms.add(box(31, 1.6, 10.6, 0, 0, sz + 5.3), GRANITE, f);
  ms.add(gable(31, 6, 10.6, 1.6, sz + 5.3), GRANITE_ROOF, f);

  // Rotunda block, drum and colonnade, attic, dome, lantern and statue.
  ms.add(box(46, 8, 46, 0, 0, 0), GRANITE, f);
  ms.add(cyl(16, 16, 13, 8), GRANITE_LIGHT, f);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ms.add(box(1.2, 13, 1.2, Math.cos(a) * 17.6, 8, Math.sin(a) * 17.6), GRANITE_LIGHT, f);
  }
  ms.add(cyl(18.6, 18.6, 1.6, 21), GRANITE, f);
  ms.add(cyl(15.6, 16.2, 4.6, 22.6), GRANITE_LIGHT, f);
  ms.add(dome(15.6, 22, 27.2), DOME, f);
  ms.add(cyl(3.2, 3.5, 7, 49), DOME, f);
  ms.add(dome(3.6, 2.6, 56, 12, 4), DOME, f);
  ms.add(box(1.5, 1.4, 1.5, 0, 58.4, 0), STATUE, f);
  ms.add(cyl(0.55, 0.8, 4.6, 59.8, 8), STATUE, f);
  ms.add(dome(0.55, 0.9, 64.4, 8, 3), STATUE, f);
  ms.add(box(0.35, 2.4, 0.35, 0.75, 63.2, 0), STATUE, f); // her raised arm and star
}

// ---------------------------------------------------------------- the UT Tower

/**
 * The University of Texas Main Building and Tower (1937): limestone under red tile, the shaft
 * rising 94 m to a colonnaded belfry and a small pyramid roof. The shaft is lit orange at night.
 */
function utTower(ms: Mesher, soft: Mesher, hot: Mesher, c: Central, ground: HeightField) {
  const outline = c.landmarks["ut-tower"]?.outline;
  const [ux, uz] = project(-97.73943, 30.28619);
  const [lo, hi] = outline ? groundRange(ground, outline) : [groundY(ground, ux, uz), groundY(ground, ux, uz)];
  const roofM = 18;
  const roofY = hi + roofM * V;
  if (outline) extrude(ms, outline, lo - 0.003, roofY, LIMESTONE, TILE);
  const f = frame(ux, roofY, uz);

  soft.add(box(18, 46, 18, 0, 0, 0), LIMESTONE, f);
  for (let k = 0; k < 4; k++) {
    // Clock faces high on the shaft.
    const a = (k / 4) * Math.PI * 2;
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
  const roof = new THREE.ConeGeometry(6.4, 5.5, 4, 1);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 70.5 + 2.75, 0);
  ms.add(roof, TILE, f);
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
  ) {}

  private vtx(p: number[], u: number) {
    this.pos.push(p[0], p[1], p[2]);
    this.info.push(-1, this.yBase, this.hM, this.r);
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
 * Darrell K Royal–Texas Memorial Stadium: a bowl of burnt-orange lower seats and grey upper
 * decks around a north–south field, tallest on the west side.
 */
function stadium(ms: Mesher, c: Central, ground: HeightField) {
  const o = c.landmarks["dkr-stadium"];
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
  // The bowl is cut into a slope: build it from the field's level.
  let yc = lo;
  for (const [fx, fz] of [
    [0, 0],
    [-0.042, -0.07],
    [0.042, -0.07],
    [0.042, 0.07],
    [-0.042, 0.07],
    [0.042, 0],
    [-0.042, 0],
  ]) {
    yc = Math.max(yc, groundY(ground, cx + fx, cz + fz));
  }
  const y = yc + 0.0005;
  const orange = new THREE.Color("#bf5700");
  const grey = new THREE.Color("#b9b4ab");
  const facade = new THREE.Color("#d8d1c3");
  const walk = new THREE.Color("#77736d");
  const turf = new THREE.Color("#3e7a37");
  const white = new THREE.Color("#f4f4ef");

  // Field: 100 yards plus end zones, north–south.
  const W = 0.0244;
  const Lf = 0.0549;
  const P = (x: number, z: number, yy: number) => [cx + x, yy, cz + z];
  ms.quad(P(-0.042, -0.07, y), P(0.042, -0.07, y), P(0.042, 0.07, y), P(-0.042, 0.07, y), turf);
  for (const s of [-1, 1]) {
    ms.quad(P(-W, s * 0.0457, y + 0.0002), P(W, s * 0.0457, y + 0.0002), P(W, s * Lf, y + 0.0002), P(-W, s * Lf, y + 0.0002), orange);
  }
  for (let k = -5; k <= 5; k++) {
    const z = k * 0.00914;
    ms.quad(P(-W, z - 0.0003, y + 0.0003), P(W, z - 0.0003, y + 0.0003), P(W, z + 0.0003, y + 0.0003), P(-W, z + 0.0003, y + 0.0003), white);
  }

  // The bowl, lofted from the field's edge out to the stadium's outline.
  const steps = 72;
  const ring3: number[][][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const tIn = Math.min(0.042 / Math.max(1e-6, Math.abs(dx)), 0.07 / Math.max(1e-6, Math.abs(dz)));
    const tOut = Math.max(tIn + 0.02, Math.min(rayExit(r, cx, cz, dx, dz), 0.2));
    const we = Math.max(0, dx) ** 2;
    const ww = Math.max(0, -dx) ** 2;
    const wn = Math.max(0, -dz) ** 2;
    const wsth = Math.max(0, dz) ** 2;
    const hM = (50 * we + 62 * ww + 30 * wn + 46 * wsth) / (we + ww + wn + wsth);
    const tMid = tIn + (tOut - tIn) * 0.5;
    const tWalk = tMid + (tOut - tIn) * 0.06;
    const yMid = yc + hM * 0.38 * V;
    ring3.push([
      [cx + dx * tIn, yc + 3 * V, cz + dz * tIn],
      [cx + dx * tMid, yMid, cz + dz * tMid],
      [cx + dx * tWalk, yMid + 0.6 * V, cz + dz * tWalk],
      [cx + dx * tOut, yc + hM * V, cz + dz * tOut],
      [cx + dx * tOut, lo - 0.003, cz + dz * tOut],
    ]);
  }
  for (let i = 0; i < steps; i++) {
    const a = ring3[i];
    const b = ring3[i + 1];
    ms.quad(a[0], b[0], b[1], a[1], orange);
    ms.quad(a[1], b[1], b[2], a[2], walk);
    ms.quad(a[2], b[2], b[3], a[3], grey);
    ms.quad(a[3], b[3], b[4], a[4], facade);
    // A low wall around the field.
    ms.quad([a[0][0], y, a[0][2]], [b[0][0], y, b[0][2]], b[0], a[0], facade);
  }
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
  soft: THREE.MeshLambertMaterial;
  hot: THREE.MeshLambertMaterial;
  lamps: THREE.MeshLambertMaterial;
  glow: THREE.PointsMaterial;
  glowPoints: THREE.Points;
}

function glowTexture(): THREE.Texture {
  const s = 64;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const g = cv.getContext("2d")!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.18, "rgba(235,242,255,0.85)");
  grd.addColorStop(0.45, "rgba(200,215,255,0.25)");
  grd.addColorStop(1, "rgba(200,215,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function build(c: Central, ground: HeightField): { root: THREE.Group; glass: THREE.BufferGeometry } {
  const stone = new Mesher();
  const glassOut: GlassOut = { pos: [], info: [], u: [] };
  const soft = new Mesher();
  const hot = new Mesher();
  const lamps = new Mesher();
  const lines: number[] = [];
  const lcol: number[] = [];
  const glow: number[] = [];

  capitol(stone, c, ground);
  utTower(stone, soft, hot, c, ground);
  moonlightTowers(c, ground, lines, lcol, lamps, glow);
  bonnell(stone, ground);
  pennybacker(stone, lines, lcol, ground);
  frostTower(glassOut, c, ground);
  independent(glassOut, stone, c, ground);
  block185(glassOut, c, ground);
  stadium(stone, c, ground);
  moody(stone, c, ground);
  tomMillerDam(stone, c, ground);
  longhornDam(stone, ground);

  const mat = () => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const parts: Parts = {
    stone: mat(),
    soft: mat(),
    hot: mat(),
    lamps: mat(),
    glow: new THREE.PointsMaterial({
      map: glowTexture(),
      color: "#e4ecff",
      size: 30 * Math.min(2, window.devicePixelRatio || 1),
      sizeAttenuation: false,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    glowPoints: new THREE.Points(),
  };
  const root = new THREE.Group();
  root.add(new THREE.Mesh(stone.geometry(), parts.stone));
  root.add(new THREE.Mesh(soft.geometry(), parts.soft));
  root.add(new THREE.Mesh(hot.geometry(), parts.hot));
  root.add(new THREE.Mesh(lamps.geometry(), parts.lamps));
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
  lg.setAttribute("color", new THREE.Float32BufferAttribute(lcol, 3));
  root.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })));
  const gg = new THREE.BufferGeometry();
  gg.setAttribute("position", new THREE.Float32BufferAttribute(glow, 3));
  parts.glowPoints = new THREE.Points(gg, parts.glow);
  parts.glowPoints.renderOrder = 2;
  root.add(parts.glowPoints);
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
    p.soft.emissive.setRGB(0.78, 0.3, 0.04).multiplyScalar(n * 0.7);
    p.hot.emissive.setRGB(1, 0.46, 0.08).multiplyScalar(n);
    p.lamps.emissive.setRGB(0.85, 0.9, 1).multiplyScalar(n);
    p.glow.opacity = Math.min(1, n * 1.3);
    p.glowPoints.visible = n > 0.03;
  });

  return (
    <>
      <primitive ref={ref} object={root} />
      <Buildings geometry={glass} />
    </>
  );
}
