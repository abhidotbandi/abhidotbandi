"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import earcut from "earcut";
import type { Polyline } from "@/lib/atlas/assets";
import type { Central } from "@/lib/atlas/central";
import { BUILDING_EXAG, groundY, project, type HeightField } from "@/lib/atlas/geo";
import { sky } from "@/lib/atlas/timeOfDay";

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

function build(c: Central, ground: HeightField): THREE.Group {
  const stone = new Mesher();
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
  return root;
}

export default function Landmarks({ central, ground }: { central: Central; ground: HeightField }) {
  const ref = useRef<THREE.Group>(null);
  const root = useMemo(() => build(central, ground), [central, ground]);

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

  return <primitive ref={ref} object={root} />;
}
