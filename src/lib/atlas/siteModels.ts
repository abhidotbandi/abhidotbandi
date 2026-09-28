import * as THREE from "three";
import earcut from "earcut";
import { SITE_BY_ID, type SiteRef } from "@/data/atlas/companies";
import type { BuildingsData } from "./buildingsCodec";
import { BUILDING_EXAG, elevToY, groundY, type HeightField } from "./geo";

// The signature sites as models instead of plain extrusions: Giga Texas under its solar roof,
// Samsung's fabs in Austin and Taylor with their cooling towers and gas yards, the test stands at
// Firefly's Rocket Ranch and the Starlink factory at Bastrop. The buildings stand on their mapped
// footprints. The plant around them goes where the map has no building or street (each spot was
// checked against every footprint and street nearby), and the trees keep off it.

const M = 0.001; // metres -> km
const V = M * BUILDING_EXAG; // vertical metres -> km, boosted like the buildings
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
} as const;

export const MODELLED_SITES = ["tesla", "samsung", "samsung-taylor", "firefly-ranch", "spacex"];

const C = {
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
};

type V3 = [number, number, number];
/** A band of wall: height (m), colour, glow. */
type Band = [number, string, number?];

/** Triangles with a colour, a site and a glow each, merged into one geometry. */
class Kit {
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
function place(x: number, y: number, z: number, heading = 0, scale = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(UP, -heading),
    new THREE.Vector3(M * scale, V * scale, M * scale),
  );
}

/** Box standing on y (metres). */
function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return g;
}

/** Cylinder (or cone) standing on y (metres). */
function cyl(rTop: number, rBottom: number, h: number, x = 0, y = 0, z = 0, seg = 12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1);
  g.translate(x, y + h / 2, z);
  return g;
}

/** Cylinder lying along z, its axis at height y. */
function drum(r: number, len: number, x: number, y: number, z: number, seg = 12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/** Half-sphere cap of radius r, flattened to height h, standing on y. */
function cap(r: number, h: number, x: number, y: number, z: number, seg = 12): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, seg, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1, h / r, 1);
  g.translate(x, y, z);
  return g;
}

/** A square strut t thick from a to b (metres). */
function strut(a: V3, b: V3, t: number): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const g = new THREE.BoxGeometry(t, va.distanceTo(vb), t);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, vb.clone().sub(va).normalize()));
  const mid = va.add(vb).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

interface Footprint {
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
function siteFootprints(d: BuildingsData, siteId: string, ground: HeightField): Footprint[] {
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

function pointInRing(ring: number[], x: number, z: number): boolean {
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
function distToRing(ring: number[], x: number, z: number): number {
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
function at(f: Footprint, p: number, q: number): [number, number] {
  return [f.ox + (f.ux * p - f.uz * q) * M, f.oz + (f.uz * p + f.ux * q) * M];
}

const headingOf = (f: Footprint) => Math.atan2(f.uz, f.ux);

/** Walls in bands from the lowest corner up, and a flat roof; returns the roof's y. */
function building(kit: Kit, f: Footprint, bands: Band[], roof: string): number {
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
function roofGrid(f: Footprint, stepP: number, stepQ: number, margin: number): [number, number][] {
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
function slab(kit: Kit, shape: number[], to: (x: number, y: number) => [number, number], y: number, h: number, color: string, glow: number) {
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
function rooftopUnits(kit: Kit, f: Footprint, top: number, step = 30) {
  for (const [p, q] of roofGrid(f, step, step * 0.8, 10)) {
    const [x, z] = at(f, p, q);
    kit.part(box(7, 2.6, 4), C.unit, place(x, top, z, headingOf(f)));
  }
}

// --- Giga Texas ------------------------------------------------------------------------------

/**
 * Tesla's T as solar arrays: the thin arc on top, the bar (an arch, thickest in the middle and
 * tapering to points) and, below a narrow gap, the stem narrowing downwards. x and y in -1..1.
 */
function teslaT(): number[][] {
  const N = 18;
  const arc = (x: number) => 0.99 - 0.14 * x * x;
  const barTop = (x: number) => 0.87 - 0.15 * x * x;
  const barBottom = (x: number) => barTop(x) - 0.24 * (1 - Math.pow(Math.abs(x) / 0.94, 2.5));
  const xs = (a: number, i: number) => -a + (2 * a * i) / N;
  const thin: number[] = [];
  for (let i = 0; i <= N; i++) thin.push(xs(0.98, i), arc(xs(0.98, i)));
  for (let i = N; i >= 0; i--) thin.push(xs(0.98, i), arc(xs(0.98, i)) - 0.06);
  const bar: number[] = [];
  for (let i = 0; i <= N; i++) bar.push(xs(0.94, i), barTop(xs(0.94, i)));
  for (let i = N - 1; i >= 1; i--) bar.push(xs(0.94, i), barBottom(xs(0.94, i)));
  const stem: number[] = [];
  for (let i = 0; i <= 6; i++) stem.push(xs(0.16, (i * N) / 6), barBottom(xs(0.16, (i * N) / 6)) - 0.055);
  stem.push(0.1, -1.0, -0.1, -1.0);
  return [thin, bar, stem];
}

function gigaTexas(kit: Kit, fps: Footprint[]) {
  const [hall, ...rest] = fps;
  // The hall's sections are mapped as footprints of their own too: the hall covers them.
  for (const f of rest) {
    if (pointInRing(hall.ring, f.cx, f.cz)) continue;
    const top = building(kit, f, [[f.hM - 1, C.wall], [1, C.wall, GLOW.accent]], C.roof);
    rooftopUnits(kit, f, top);
  }
  const H = hall.hM;
  const top = building(
    kit,
    hall,
    [
      [5, C.plinth],
      [H * 0.68 - 5, C.wall],
      [H * 0.15, C.glass, GLOW.windows],
      [H * 0.17 - 0.9, C.wall],
      [0.9, C.wall, GLOW.accent],
    ],
    C.roof,
  );
  const hd = headingOf(hall);
  const L = hall.a * 1000;
  const W = hall.b * 1000;
  // Solar arrays over the ends of the roof, and the T between them, top to the north.
  const logoHalf = 140;
  for (let p = -L + 36; p <= L - 36; p += 46) {
    if (Math.abs(p) < logoHalf + 25) continue;
    for (let q = -W + 23; q <= W - 23; q += 22) {
      const [x, z] = at(hall, p, q);
      if (pointInRing(hall.ring, x, z) && distToRing(hall.ring, x, z) * 1000 > 24) {
        kit.part(box(40, 0.8, 18), C.solar, place(x, top, z, hd), GLOW.solar);
      }
    }
  }
  const s = hall.uz > 0 ? -1 : 1; // the axis points south: north is -p
  for (const shape of teslaT()) {
    slab(kit, shape, (x, y) => at(hall, s * y * 140, s * x * 125), top, 0.9, C.solar, GLOW.solar);
  }
  // Plant along the long sides.
  for (let p = -L + 30; p <= L - 30; p += 32) {
    for (const q of [-W + 9, W - 9]) {
      const [x, z] = at(hall, p, q);
      if (pointInRing(hall.ring, x, z)) kit.part(box(8, 2.6, 5), C.unit, place(x, top, z, hd));
    }
  }
}

// --- Samsung's fabs --------------------------------------------------------------------------

interface FabPlan {
  /** metres east and north of the site point: the building whose roof carries the cooling towers */
  cub: [number, number];
  /** the gas yard: metres east and north of the site point, and its heading (degrees) */
  yard: [number, number, number];
  /** heights (m) for the largest footprints, where the map has none */
  heights?: number[];
}

const FABS: Record<string, FabPlan> = {
  samsung: { cub: [106, -257], yard: [88, -360, 28] },
  "samsung-taylor": { cub: [140, -238], yard: [390, -200, 9], heights: [40, 26, 30, 28] },
};

/** East and north of a site point (metres) in scene km. */
const offset = (s: SiteRef, e: number, n: number): [number, number] => [s.x + e * M, s.z - n * M];

function fabRoof(kit: Kit, f: Footprint, top: number) {
  const hd = headingOf(f);
  roofGrid(f, 34, 26, 12).forEach(([p, q], k) => {
    const [x, z] = at(f, p, q);
    const m = place(x, top, z, hd);
    if ((k + (Math.round(p / 34) & 1)) % 3 === 0) {
      // Exhaust stacks, in pairs.
      kit.part(cyl(1.3, 1.3, 10, -3, 0, 0, 10), C.stack, m);
      kit.part(cyl(1.3, 1.3, 10, 3, 0, 0, 10), C.stack, m);
    } else {
      kit.part(box(14, 4.5, 7), C.unit, m);
    }
  });
}

function coolingTowers(kit: Kit, f: Footprint, top: number, steam: number[]) {
  const hd = headingOf(f);
  const n = Math.max(1, Math.min(8, Math.floor((f.a * 2000 - 24) / 15)));
  for (let i = 0; i < n; i++) {
    for (const q of [-8, 8]) {
      const [x, z] = at(f, (i - (n - 1) / 2) * 15, q);
      const m = place(x, top, z, hd);
      kit.part(box(13.5, 5, 13.5), C.towerBody, m);
      kit.part(cyl(5.4, 5.8, 3.4, 0, 5, 0, 16), C.towerShroud, m);
      kit.part(cyl(4.9, 4.9, 0.3, 0, 8.1, 0, 16), C.fan, m);
      steam.push(x, top + 8.6 * V, z);
    }
  }
}

/** Bulk gases: air-separation columns and the cold box, storage tanks, tube trailers' drums. */
function gasYard(kit: Kit, ground: HeightField, x: number, z: number, heading: number) {
  const m = place(x, groundY(ground, x, z) - 0.001, z, heading);
  kit.part(box(28, 1.4, 44), C.concrete, m);
  for (const cz of [-14, -5]) {
    kit.part(cyl(1.9, 1.9, 46, -8, 1, cz), C.tank, m);
    kit.part(cyl(2.7, 2.7, 0.5, -8, 30, cz), C.steel, m);
    kit.part(box(0.9, 0.9, 0.9, -8, 47, cz), C.dark, m, GLOW.beacon);
  }
  kit.part(box(5, 30, 6, -8, 1, 7), C.tankShade, m);
  for (const cz of [-15, -7, 1, 9]) {
    kit.part(cyl(2.8, 2.8, 15, 3, 1, cz), C.tank, m);
    kit.part(cap(2.8, 1.4, 3, 16, cz), C.tank, m);
  }
  for (const cx of [9.5, 12.5]) kit.part(drum(1.3, 14, cx, 2.6, 8), C.tankShade, m);
  kit.clearRect(x, z, 34, 50, heading);
}

function fab(kit: Kit, fps: Footprint[], s: SiteRef, plan: FabPlan, ground: HeightField, steam: number[]) {
  const [cx, cz] = offset(s, ...plan.cub);
  let cub = fps[0];
  for (const f of fps) if (Math.hypot(f.cx - cx, f.cz - cz) < Math.hypot(cub.cx - cx, cub.cz - cz)) cub = f;
  fps.forEach((f, i) => {
    if (fps.some((g) => g !== f && g.areaM2 > f.areaM2 && pointInRing(g.ring, f.cx, f.cz))) return;
    const h = plan.heights?.[i] ?? f.hM;
    const office = f.areaM2 < 4000;
    const bands: Band[] = office
      ? [
          [h * 0.5, C.fabWall],
          [2.2, C.glass, GLOW.windows],
          [h * 0.5 - 3.2, C.fabWall],
          [1, C.fabWall, GLOW.accent],
        ]
      : [
          [h - 3.4, C.fabWall],
          [1.4, C.fabWall, GLOW.accent],
          [2, C.fabWall],
        ];
    const top = building(kit, f, bands, C.fabRoof);
    if (f === cub) coolingTowers(kit, f, top, steam);
    else if (f.areaM2 > 8000) fabRoof(kit, f, top);
    else rooftopUnits(kit, f, top, 24);
  });
  const [yx, yz] = offset(s, plan.yard[0], plan.yard[1]);
  gasYard(kit, ground, yx, yz, (plan.yard[2] * Math.PI) / 180);
}

// --- Firefly's Rocket Ranch ------------------------------------------------------------------

/** The stage test stand: a steel tower over a flame trench, with a first stage in it. */
function stageStand(kit: Kit, ground: HeightField, x: number, z: number) {
  const m = place(x, groundY(ground, x, z) - 0.001, z);
  const H = 44;
  const s = 6;
  kit.part(box(26, 1.5, 26), C.concrete, m);
  kit.part(box(8, 0.2, 12, 0, 1.5, 0), C.dark, m);
  kit.part(box(18, 2.4, 10, 17, 0, 0), C.concrete, m); // the flame deflector's run to the east
  const legs: [number, number][] = [
    [-s, -s],
    [s, -s],
    [s, s],
    [-s, s],
  ];
  for (const [lx, lz] of legs) kit.part(box(0.9, H - 1.5, 0.9, lx, 1.5, lz), C.steel, m);
  for (let y = 1.5; y + 6 <= H + 0.1; y += 6) {
    for (let i = 0; i < 4; i++) {
      const [ax, az] = legs[i];
      const [bx, bz] = legs[(i + 1) % 4];
      kit.part(strut([ax, y + 6, az], [bx, y + 6, bz], 0.5), C.steel, m);
      kit.part(strut([ax, y, az], [bx, y + 6, bz], 0.35), C.steel, m);
    }
  }
  kit.part(box(15, 0.8, 15, 0, H, 0), C.steel, m);
  kit.part(box(1, 7, 1, 5, H + 0.8, -5), C.steel, m);
  kit.part(box(12, 0.8, 0.8, 0, H + 7, -5), C.steel, m); // the jib that lifts stages in
  kit.part(cyl(1.0, 1.0, 22, 0, 6, 0, 16), C.rocket, m);
  kit.part(cyl(1.04, 1.04, 1.6, 0, 26.5, 0, 16), C.black, m);
  kit.part(box(0.9, 0.9, 0.9, 5, H + 7.8, -5), C.dark, m, GLOW.beacon);
  for (const [px, pz] of [
    [-17, -17],
    [17, 17],
    [-17, 17],
  ]) {
    kit.part(box(0.5, 20, 0.5, px, 0, pz), C.steel, m);
    kit.part(box(2.4, 1.2, 1.2, px, 20, pz), C.dark, m, GLOW.lamp);
  }
  kit.clearRect(x + 0.004, z, 44, 40);
}

/** A horizontal engine stand firing east; returns the nozzle's exit (world, km). */
function engineStand(kit: Kit, ground: HeightField, x: number, z: number): THREE.Vector3 {
  // Drawn a size up, as the figures are, so the stand reads from the tour's distance.
  const K = 1.4;
  const m = place(x, groundY(ground, x, z) - 0.001, z, 0, K);
  kit.part(box(34, 0.8, 16, 4, 0, 0), C.concrete, m);
  kit.part(box(6, 10, 12, -9, 0.8, 0), C.concrete, m); // thrust block
  for (const fx of [-5, 3]) for (const fz of [-3, 3]) kit.part(box(0.6, 8, 0.6, fx, 0.8, fz), C.steel, m);
  for (const fz of [-3, 3]) kit.part(box(8.6, 0.6, 0.6, -1, 8.8, fz), C.steel, m);
  for (const fx of [-5, 3]) kit.part(box(0.6, 0.6, 6.6, fx, 8.8, 0), C.steel, m);
  const engine = new THREE.CylinderGeometry(0.8, 0.8, 3, 12, 1);
  engine.rotateZ(Math.PI / 2);
  engine.translate(-2, 5.8, 0);
  kit.part(engine, C.dark, m);
  const bell = new THREE.CylinderGeometry(0.35, 1.2, 2.4, 14, 1, true);
  bell.rotateZ(-Math.PI / 2);
  bell.translate(0.7, 5.8, 0);
  kit.part(bell, C.steel, m);
  for (const fz of [-5.5, 5.5]) kit.part(cyl(1.6, 1.6, 10, -14, 0.8, fz), C.tank, m);
  for (const [px, pz] of [
    [10, -9],
    [10, 9],
  ]) {
    kit.part(box(0.4, 12, 0.4, px, 0.8, pz), C.steel, m);
    kit.part(box(1.6, 0.9, 0.9, px, 12.8, pz), C.dark, m, GLOW.lamp);
  }
  kit.clearRect(x + 0.004, z, 60, 30);
  return new THREE.Vector3(1.9, 5.8, 0).applyMatrix4(m);
}

/** Propellant: a LOX tank, kerosene drums, and a run tank. */
function tankFarm(kit: Kit, ground: HeightField, x: number, z: number) {
  const m = place(x, groundY(ground, x, z) - 0.001, z);
  kit.part(box(46, 0.8, 36), C.concrete, m);
  kit.part(cyl(4.2, 4.2, 16, -12, 0.8, -6, 16), C.tank, m);
  kit.part(cap(4.2, 2.4, -12, 16.8, -6, 16), C.tank, m);
  for (const dz of [-8, 4]) {
    kit.part(drum(2.2, 18, 8, 3.4, dz), C.tankShade, m);
    kit.part(box(5, 1.4, 1, 8, 0.8, dz - 6), C.concrete, m);
    kit.part(box(5, 1.4, 1, 8, 0.8, dz + 6), C.concrete, m);
  }
  kit.part(cyl(3, 3, 14, -12, 0.8, 10, 14), C.tank, m);
  kit.clearRect(x, z, 50, 40);
}

function waterTower(kit: Kit, ground: HeightField, x: number, z: number) {
  const m = place(x, groundY(ground, x, z) - 0.001, z);
  for (const [lx, lz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    kit.part(strut([lx * 4.5, 0, lz * 4.5], [lx * 3, 28, lz * 3], 0.6), C.steel, m);
  }
  kit.part(cyl(6.5, 6.5, 7, 0, 28, 0, 16), C.tank, m);
  kit.part(cyl(0.4, 6.8, 2.6, 0, 35, 0, 16), C.tankShade, m);
  kit.part(box(0.8, 0.8, 0.8, 0, 37.6, 0), C.dark, m, GLOW.beacon);
  kit.clearRect(x, z, 16, 16);
}

/** The control bunker, bermed on the side facing the stands. */
function bunker(kit: Kit, ground: HeightField, x: number, z: number, heading: number) {
  const m = place(x, groundY(ground, x, z) - 0.001, z, heading);
  kit.part(box(24, 5, 12), C.concrete, m);
  kit.part(box(28, 3.2, 7, 0, 0, -9), C.earth, m);
  kit.part(box(8, 1.2, 1.6, 4, 5, 2), C.unit, m);
  kit.clearRect(x, z, 32, 26, heading);
}

function rocketRanch(kit: Kit, fps: Footprint[], s: SiteRef, ground: HeightField): THREE.Vector3 {
  for (const f of fps) building(kit, f, [[f.hM - 1.2, C.shedWall], [1.2, C.shedWall, GLOW.accent]], C.shedRoof);
  // The test area, in the open east of the ranch's shop buildings.
  stageStand(kit, ground, ...offset(s, 470, -120));
  const nozzle = engineStand(kit, ground, ...offset(s, 450, -250));
  tankFarm(kit, ground, ...offset(s, 545, -180));
  waterTower(kit, ground, ...offset(s, 400, -60));
  bunker(kit, ground, ...offset(s, 420, -315), (20 * Math.PI) / 180);
  return nozzle;
}

// --- Starlink, Bastrop -----------------------------------------------------------------------

function starlink(kit: Kit, fps: Footprint[]) {
  fps.forEach((f, i) => {
    const h = f.hM;
    if (i > 0) {
      building(kit, f, [[h * 0.45, C.wall], [2, C.glass, GLOW.windows], [h * 0.55 - 3, C.wall], [1, C.wall, GLOW.accent]], C.roof);
      return;
    }
    const top = building(
      kit,
      f,
      [
        [3.5, C.plinthLight],
        [h - 6, C.wall],
        [1.3, C.black],
        [1.2, C.wall, GLOW.accent],
      ],
      C.roof,
    );
    rooftopUnits(kit, f, top, 32);
    // Skylights between the units, lit from inside after dark.
    for (const [p, q] of roofGrid(f, 32, 25.6, 24)) {
      const [x, z] = at(f, p + 16, q + 12.8);
      if (pointInRing(f.ring, x, z) && distToRing(f.ring, x, z) * 1000 > 14) {
        kit.part(box(18, 0.6, 3), C.glass, place(x, top, z, headingOf(f)), GLOW.windows);
      }
    }
    // Loading docks on the side facing the truck court (south-east), trailers backed up to them.
    const sides = [
      { nx: f.ux, nz: f.uz, depth: f.a, along: f.b },
      { nx: -f.ux, nz: -f.uz, depth: f.a, along: f.b },
      { nx: -f.uz, nz: f.ux, depth: f.b, along: f.a },
      { nx: f.uz, nz: -f.ux, depth: f.b, along: f.a },
    ];
    const side = sides.reduce((a, b) => (b.nx + b.nz > a.nx + a.nz ? b : a));
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
      if (r - Math.floor(r) < 0.6) {
        const [tx, tz] = out(9.2);
        kit.part(box(16, 4, 2.6, 0, 0.6, 0), C.trailer, place(tx, f.y0, tz, hd));
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------

export interface SiteModelSet {
  /** positions, aColor (linear), aKind (SITES index, GLOW) */
  geometry: THREE.BufferGeometry | null;
  /** per SITES index: highest point of the site's model (world y), or NaN */
  siteTop: Float32Array;
  /** cooling towers' outlets (world, km, xyz), for their steam */
  steam: Float32Array;
  /** the Rocket Ranch's engine stand: its nozzle exit */
  engine: THREE.Vector3 | null;
  /** ground under the plant, as footprints the detail tiles keep their trees off */
  clearings: BuildingsData;
}

function asFootprints(rings: number[][]): BuildingsData {
  const count = rings.length;
  const ringStart = new Uint32Array(count + 1);
  const vertStart = new Uint32Array(count + 1);
  const n = rings.reduce((s, r) => s + r.length / 2, 0);
  const x = new Int32Array(n);
  const z = new Int32Array(n);
  let v = 0;
  rings.forEach((r, i) => {
    ringStart[i + 1] = i + 1;
    vertStart[i] = v;
    for (let j = 0; j < r.length; j += 2) {
      x[v] = Math.round(r[j] * 1000);
      z[v++] = Math.round(r[j + 1] * 1000);
    }
  });
  vertStart[count] = v;
  return { sites: [], count, height: new Uint16Array(count), site: new Int16Array(count).fill(-1), ringStart, vertStart, x, z };
}

/** Models for the signature sites, on their footprints in the regional building file. */
export function buildSiteModels(data: BuildingsData, ground: HeightField, siteCount: number): SiteModelSet {
  const kit = new Kit();
  const steam: number[] = [];
  let engine: THREE.Vector3 | null = null;
  for (const id of MODELLED_SITES) {
    const s = SITE_BY_ID.get(id);
    const fps = siteFootprints(data, id, ground);
    if (!s || !fps.length) continue;
    kit.site = s.index;
    if (id === "tesla") gigaTexas(kit, fps);
    else if (id === "spacex") starlink(kit, fps);
    else if (id === "firefly-ranch") engine = rocketRanch(kit, fps, s, ground);
    else if (FABS[id]) fab(kit, fps, s, FABS[id], ground, steam);
  }
  const siteTop = new Float32Array(siteCount).fill(Number.NaN);
  for (const [i, y] of kit.top) siteTop[i] = y;
  let geometry: THREE.BufferGeometry | null = null;
  if (kit.pos.length) {
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(kit.pos, 3));
    geometry.setAttribute("aColor", new THREE.Float32BufferAttribute(kit.col, 3));
    geometry.setAttribute("aKind", new THREE.Float32BufferAttribute(kit.kind, 2));
    geometry.computeBoundingSphere();
  }
  return { geometry, siteTop, steam: new Float32Array(steam), engine, clearings: asFootprints(kit.clear) };
}
