import * as THREE from "three";
import earcut from "earcut";
import type { SiteRef } from "@/data/atlas/companies";
import type { BuildingsData } from "../buildingsCodec";
import { BUILDING_EXAG, elevToY, type HeightField } from "../geo";

// The kit the site models are built with: coloured triangles tagged with their site and how
// they're lit, parts authored in metres, and the sites' footprints with their oriented boxes.

export const M = 0.001; // metres -> km
export const V = M * BUILDING_EXAG; // vertical metres -> km, boosted like the buildings
const UP = new THREE.Vector3(0, 1, 0);

/** How a part is lit; the SiteModels shader reads it. */
export const GLOW = {
  none: 0,
  /** a band of windows, lit after dark */
  windows: 1,
  /** trim in the site's domain colour */
  accent: 2,
  /** a red obstruction light, blinking */
  beacon: 3,
  /** a floodlight, on after dark */
  lamp: 4,
  /** solar panels, with the sky in them */
  solar: 5,
  /** a wall with punched windows, lit after dark */
  punched: 6,
} as const;

export const C = {
  wall: "#eceef0",
  plinth: "#8e949a",
  plinthLight: "#b9bec3",
  glass: "#3c4957",
  roof: "#cdd1d4",
  unit: "#a3aab0",
  stack: "#7b838b",
  solar: "#243349",
  fabWall: "#f1f2f3",
  fabRoof: "#d6d9dc",
  precast: "#e3dbc9",
  precastRoof: "#cec7b7",
  towerBody: "#b3bac0",
  towerShroud: "#8f989f",
  fan: "#3a3f45",
  tank: "#eef0f1",
  tankShade: "#d9dde0",
  steel: "#8b939a",
  concrete: "#c9c4b9",
  earth: "#a79a7f",
  shedWall: "#dfe3e6",
  shedRoof: "#98a2ac",
  black: "#202428",
  trailer: "#f1f1ee",
  door: "#565c63",
  rocket: "#f4f4f1",
  dark: "#2b2f34",
  metalWall: "#80858c",
  machine: "#5e646b",
  yellow: "#f2b705",
  tilt: "#dcd6cb",
  metalLight: "#c7ccd1",
  stucco: "#e6ddcc",
  limestone: "#e1d5bd",
  curtain: "#5b7083",
  hull: "#a2abb3",
  cabin: "#3d4349",
  white: "#f2f2ef",
  pallet: "#9c7a55",
  radome: "#f1efea",
  printed: "#bfae94",
  truss: "#c4cad0",
};

export type V3 = [number, number, number];
/** A band of wall: height (m), colour, glow. */
export type Band = [number, string, number?];

/** Triangles with a colour, a site and a glow each, merged into one geometry. */
export class Kit {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly kind: number[] = [];
  /** SITES index of the parts being added */
  site = -1;
  /** per SITES index: highest point of its model (world y) */
  readonly top = new Map<number, number>();
  /** ground the plant stands on (closed rings, km), which the detail tiles keep their trees off */
  readonly clear: number[][] = [];
  private readonly c = new THREE.Color();

  private vtx(x: number, y: number, z: number, glow: number) {
    this.pos.push(x, y, z);
    this.col.push(this.c.r, this.c.g, this.c.b);
    this.kind.push(this.site, glow);
    const t = this.top.get(this.site);
    if (this.site >= 0 && (t === undefined || y > t)) this.top.set(this.site, y);
  }

  /** A part authored in metres (y up), placed by `m`. */
  part(g: THREE.BufferGeometry, color: string, m: THREE.Matrix4, glow: number = GLOW.none) {
    const geo = g.index ? g.toNonIndexed() : g;
    geo.applyMatrix4(m);
    const p = geo.getAttribute("position").array;
    this.c.set(color);
    for (let i = 0; i < p.length; i += 3) this.vtx(p[i], p[i + 1], p[i + 2], glow);
    g.dispose();
    geo.dispose();
  }

  tri(a: V3, b: V3, c: V3, color: string, glow: number = GLOW.none) {
    this.c.set(color);
    this.vtx(a[0], a[1], a[2], glow);
    this.vtx(b[0], b[1], b[2], glow);
    this.vtx(c[0], c[1], c[2], glow);
  }

  quad(a: V3, b: V3, c: V3, d: V3, color: string, glow: number = GLOW.none) {
    this.tri(a, b, c, color, glow);
    this.tri(a, c, d, color, glow);
  }

  /** Keep trees off a rectangle w x d metres centred on (x, z) km, turned by `heading`. */
  clearRect(x: number, z: number, w: number, d: number, heading = 0) {
    const ux = Math.cos(heading);
    const uz = Math.sin(heading);
    const ring: number[] = [];
    for (const [p, q] of [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ]) {
      ring.push(x + (ux * p - uz * q) * M, z + (uz * p + ux * q) * M);
    }
    this.clear.push(ring);
  }
}

/** Placement for parts authored in metres: anchor (km), heading (radians from +x toward +z). */
export function place(x: number, y: number, z: number, heading = 0, scale = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(UP, -heading),
    new THREE.Vector3(M * scale, V * scale, M * scale),
  );
}

/** Box standing on y (metres). */
export function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return g;
}

/** Cylinder (or cone) standing on y (metres). */
export function cyl(rTop: number, rBottom: number, h: number, x = 0, y = 0, z = 0, seg = 12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1);
  g.translate(x, y + h / 2, z);
  return g;
}

/** Cylinder lying along z, its axis at height y. */
export function drum(r: number, len: number, x: number, y: number, z: number, seg = 12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/** Half-sphere cap of radius r, flattened to height h, standing on y. */
export function cap(r: number, h: number, x: number, y: number, z: number, seg = 12): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, seg, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1, h / r, 1);
  g.translate(x, y, z);
  return g;
}

/** Undo the buildings' vertical boost on a part, so a sphere or a dish stays round. */
export function unboost(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.scale(1, 1 / BUILDING_EXAG, 1);
  return g;
}

/** A square strut t thick from a to b (metres). */
export function strut(a: V3, b: V3, t: number): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const g = new THREE.BoxGeometry(t, va.distanceTo(vb), t);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, vb.clone().sub(va).normalize()));
  const mid = va.add(vb).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

export interface Footprint {
  /** outer ring, x, z km, not closed */
  ring: number[];
  hM: number;
  areaM2: number;
  /** mean corner, km */
  cx: number;
  cz: number;
  /** ground under its lowest corner (world y) */
  y0: number;
  /** oriented box: centre, unit axis along its long side, half length and half width (km) */
  ox: number;
  oz: number;
  ux: number;
  uz: number;
  a: number;
  b: number;
}

/** The smallest box around a ring, with its axis along the long side. */
function orientedBox(ring: number[]) {
  const n = ring.length / 2;
  let best = { area: Infinity, ux: 1, uz: 0, p0: 0, p1: 0, q0: 0, q1: 0 };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ux = ring[j * 2] - ring[i * 2];
    let uz = ring[j * 2 + 1] - ring[i * 2 + 1];
    const len = Math.hypot(ux, uz);
    if (len < 1e-4) continue;
    ux /= len;
    uz /= len;
    let p0 = Infinity;
    let p1 = -Infinity;
    let q0 = Infinity;
    let q1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const p = ring[k * 2] * ux + ring[k * 2 + 1] * uz;
      const q = -ring[k * 2] * uz + ring[k * 2 + 1] * ux;
      p0 = Math.min(p0, p);
      p1 = Math.max(p1, p);
      q0 = Math.min(q0, q);
      q1 = Math.max(q1, q);
    }
    const area = (p1 - p0) * (q1 - q0);
    if (area < best.area) best = { area, ux, uz, p0, p1, q0, q1 };
  }
  let { ux, uz, p0, p1, q0, q1 } = best;
  if (q1 - q0 > p1 - p0) {
    // Turn the axis a quarter so it runs along the long side: u' = v, v' = -u.
    [ux, uz, p0, p1, q0, q1] = [-uz, ux, q0, q1, -p1, -p0];
  }
  const pc = (p0 + p1) / 2;
  const qc = (q0 + q1) / 2;
  return { ox: pc * ux - qc * uz, oz: pc * uz + qc * ux, ux, uz, a: (p1 - p0) / 2, b: (q1 - q0) / 2 };
}

/** A site's mapped footprints, largest first. */
export function siteFootprints(d: BuildingsData, siteId: string, ground: HeightField): Footprint[] {
  const k = d.sites.indexOf(siteId);
  if (k < 0) return [];
  const out: Footprint[] = [];
  for (let b = 0; b < d.count; b++) {
    if (d.site[b] !== k) continue;
    const r0 = d.ringStart[b];
    const ring: number[] = [];
    let minElev = Infinity;
    for (let j = d.vertStart[r0]; j < d.vertStart[r0 + 1]; j++) {
      const x = d.x[j] / 1000;
      const z = d.z[j] / 1000;
      ring.push(x, z);
      minElev = Math.min(minElev, ground.sample(x, z));
    }
    let n = ring.length / 2;
    if (n > 3 && ring[0] === ring[n * 2 - 2] && ring[1] === ring[n * 2 - 1]) ring.length = --n * 2;
    let area2 = 0;
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area2 += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
      sx += ring[i * 2];
      sz += ring[i * 2 + 1];
    }
    out.push({
      ring,
      hM: d.height[b] / 10,
      areaM2: (Math.abs(area2) / 2) * 1e6,
      cx: sx / n,
      cz: sz / n,
      y0: elevToY(minElev),
      ...orientedBox(ring),
    });
  }
  return out.sort((p, q) => q.areaM2 - p.areaM2);
}

export function pointInRing(ring: number[], x: number, z: number): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2];
    const zi = ring[i * 2 + 1];
    const xj = ring[j * 2];
    const zj = ring[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance (km) from a point to a ring's nearest edge. */
export function distToRing(ring: number[], x: number, z: number): number {
  let best = Infinity;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[i * 2];
    const az = ring[i * 2 + 1];
    const dx = ring[j * 2] - ax;
    const dz = ring[j * 2 + 1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/** World x, z (km) of a point p metres along a footprint's axis and q across it. */
export function at(f: Footprint, p: number, q: number): [number, number] {
  return [f.ox + (f.ux * p - f.uz * q) * M, f.oz + (f.uz * p + f.ux * q) * M];
}

export const headingOf = (f: Footprint) => Math.atan2(f.uz, f.ux);

/** Walls in bands from the lowest corner up, and a flat roof; returns the roof's y. */
export function building(kit: Kit, f: Footprint, bands: Band[], roof: string): number {
  const r = f.ring;
  const n = r.length / 2;
  let h = 0;
  for (const [bh, color, glow = GLOW.none] of bands) {
    // The first band reaches below the lowest corner, into the ground on a slope.
    const ya = h === 0 ? f.y0 - 0.003 : f.y0 + h * V;
    h += bh;
    const yb = f.y0 + h * V;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      kit.quad([r[i * 2], ya, r[i * 2 + 1]], [r[j * 2], ya, r[j * 2 + 1]], [r[j * 2], yb, r[j * 2 + 1]], [r[i * 2], yb, r[i * 2 + 1]], color, glow);
    }
  }
  const top = f.y0 + h * V;
  const tris = earcut(r);
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
    kit.tri([r[a * 2], top, r[a * 2 + 1]], [r[b * 2], top, r[b * 2 + 1]], [r[c * 2], top, r[c * 2 + 1]], roof);
  }
  return top;
}

/** Points on a grid over a roof, along its axes, at least `margin` metres inside its edge. */
export function roofGrid(f: Footprint, stepP: number, stepQ: number, margin: number): [number, number][] {
  const out: [number, number][] = [];
  const np = Math.max(0, Math.floor((f.a * 2000 - 2 * margin) / stepP));
  const nq = Math.max(0, Math.floor((f.b * 2000 - 2 * margin) / stepQ));
  for (let i = 0; i <= np; i++) {
    for (let j = 0; j <= nq; j++) {
      const p = (-np * stepP) / 2 + i * stepP;
      const q = (-nq * stepQ) / 2 + j * stepQ;
      const [x, z] = at(f, p, q);
      if (pointInRing(f.ring, x, z) && distToRing(f.ring, x, z) * 1000 >= margin) out.push([p, q]);
    }
  }
  return out;
}

/** A flat shape (x, y pairs) raised h metres off a roof at y, mapped onto the ground by `to`. */
export function slab(kit: Kit, shape: number[], to: (x: number, y: number) => [number, number], y: number, h: number, color: string, glow: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i < shape.length; i += 2) pts.push(to(shape[i], shape[i + 1]));
  const y1 = y + h * V;
  const tris = earcut(shape);
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [pts[tris[t]], pts[tris[t + 1]], pts[tris[t + 2]]];
    kit.tri([a[0], y1, a[1]], [b[0], y1, b[1]], [c[0], y1, c[1]], color, glow);
  }
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    kit.quad([a[0], y, a[1]], [b[0], y, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], color, glow);
  }
}

/** Rooftop air handlers in a grid. */
export function rooftopUnits(kit: Kit, f: Footprint, top: number, step = 30) {
  for (const [p, q] of roofGrid(f, step, step * 0.8, 10)) {
    const [x, z] = at(f, p, q);
    kit.part(box(7, 2.6, 4), C.unit, place(x, top, z, headingOf(f)));
  }
}

/** East and north of a site point (metres) in scene km. */
export const offset = (s: SiteRef, e: number, n: number): [number, number] => [s.x + e * M, s.z - n * M];

/**
 * Loading docks along the side of a footprint facing `toward` (east, north), with trailers
 * backed up to a share of them.
 */
export function docks(kit: Kit, f: Footprint, toward: [number, number], share = 0.6) {
  const sides = [
    { nx: f.ux, nz: f.uz, depth: f.a, along: f.b },
    { nx: -f.ux, nz: -f.uz, depth: f.a, along: f.b },
    { nx: -f.uz, nz: f.ux, depth: f.b, along: f.a },
    { nx: f.uz, nz: -f.ux, depth: f.b, along: f.a },
  ];
  // Scene z runs south, so north is -z.
  const score = (d: (typeof sides)[number]) => d.nx * toward[0] - d.nz * toward[1];
  const side = sides.reduce((a, b) => (score(b) > score(a) ? b : a));
  const hd = Math.atan2(side.nz, side.nx);
  const depth = side.depth * 1000;
  for (let t = -side.along * 1000 + 24, k = 0; t <= side.along * 1000 - 24; t += 18, k++) {
    // In from the box's side to the wall (the footprint needn't fill its box).
    let wx = 0;
    let wz = 0;
    let d = 0;
    for (; d < depth * 0.5; d += 2) {
      wx = f.ox + (side.nx * (depth - d) - side.nz * t) * M;
      wz = f.oz + (side.nz * (depth - d) + side.nx * t) * M;
      if (pointInRing(f.ring, wx, wz)) break;
    }
    if (d >= depth * 0.5) continue;
    const out = (dist: number): [number, number] => [wx + side.nx * dist * M, wz + side.nz * dist * M];
    const [dx, dz] = out(0.2);
    kit.part(box(0.3, 4.5, 3.6), C.door, place(dx, f.y0, dz, hd));
    const r = Math.sin(k * 12.9898) * 43758.5453;
    if (r - Math.floor(r) < share) {
      const [tx, tz] = out(9.2);
      kit.part(box(16, 4, 2.6, 0, 0.6, 0), C.trailer, place(tx, f.y0, tz, hd));
    }
  }
}
