// A decoded detail tile as mesh arrays: its buildings extruded, streets as ribbons at their real
// width, parking lots and pools as flat polygons, and trees scattered over the canopy around
// them. No three.js here, so the detail worker can run it.

import earcut from "earcut";
import { TOWER, asphaltApron, inAirfield, insideField } from "../airport";
import type { BuildingsData } from "../buildingsCodec";
import { extrudeBuildings } from "../extrude";
import { CX_MAX, CX_MIN, CZ_MAX, CZ_MIN, HEIGHT_KM, WIDTH_KM, X_MIN, Z_MIN, elevToY, type HeightField } from "../geo";
import { AREA_APRON, AREA_APRON_ASPHALT, AREA_PARKING, AREA_PARKING_ROWS, CARS, LANES_ONLY, STREETS, type TileData } from "../tiles";

export interface BuildingParts {
  position: Float32Array;
  info: Float32Array;
  u: Float32Array;
  index: Uint32Array;
}

export interface RibbonArrays {
  /** centreline point per vertex (km; y on the ground) */
  position: Float32Array;
  /** per vertex: lateral x, lateral z (mitred unit normal), side (-1 or 1), half width (km) */
  shape: Float32Array;
  /** per vertex: street class, km along the line, streetlight spacing (m, 0 for none) */
  line: Float32Array;
  index: Uint32Array;
}

/** The roads cars drive on: x, z (km) per point, with where each line starts and its class. */
export interface LaneArrays {
  xz: Float32Array;
  /** first point of each line; one more entry than there are lines */
  start: Uint32Array;
  cls: Uint8Array;
}

export interface AreaArrays {
  position: Float32Array;
  kind: Float32Array;
  index: Uint32Array;
}

export interface TileMeshes {
  buildings: BuildingParts | null;
  streets: RibbonArrays | null;
  areas: AreaArrays | null;
  lanes: LaneArrays | null;
  /** per tree: x, y, z (km), crown radius (m), variant (tint 0..127, +128 when conical) */
  trees: Float32Array;
}

/** The regional rasters the trees are scattered by. */
export interface World {
  /** the surface the base terrain mesh draws */
  ground: HeightField;
  /** elevation (m) from the raster, for the hill country's junipers */
  elevation: HeightField;
  /** regional surface: R water distance, G parkland, B tree canopy */
  surface: { width: number; height: number; rgba: Uint8Array };
  /** built-up density on the terrain raster's grid */
  density: { width: number; height: number; data: Uint8Array };
  /** the surface raster's distance-field scale: levels per pixel, metres per pixel */
  sdfLevels: number;
  surfPxM: number;
  /** the always-loaded buildings (company sites, central Austin's edge), which trees also avoid */
  fixed: BuildingsData[];
  /** per tile key: [set, building] pairs of `fixed` that reach into that tile */
  fixedByTile: Map<number, number[]>;
}

export const tileKey = (ix: number, iz: number) => ix * 4096 + iz;

/** Bucket the always-loaded buildings by tile, for the tree masks. */
export function bucketFixed(sets: BuildingsData[], size: number, origin: [number, number]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  sets.forEach((d, si) => {
    for (let b = 0; b < d.count; b++) {
      // Every tile its box reaches, so one straddling a tile's edge keeps trees off on both sides.
      const r = d.ringStart[b];
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (let v = d.vertStart[r]; v < d.vertStart[r + 1]; v++) {
        x0 = Math.min(x0, d.x[v]);
        x1 = Math.max(x1, d.x[v]);
        z0 = Math.min(z0, d.z[v]);
        z1 = Math.max(z1, d.z[v]);
      }
      const tile = (m: number, o: number) => Math.floor((m / 1000 - o) / size);
      for (let ix = tile(x0, origin[0]); ix <= tile(x1, origin[0]); ix++) {
        for (let iz = tile(z0, origin[1]); iz <= tile(z1, origin[1]); iz++) {
          const key = tileKey(ix, iz);
          let list = out.get(key);
          if (!list) out.set(key, (list = []));
          list.push(si, b);
        }
      }
    }
  });
  return out;
}

export interface TileOptions {
  /** tile edge (km) and its north-west corner (scene km) */
  size: number;
  x0: number;
  z0: number;
  /** jittered-grid spacing of tree candidates, metres */
  treeSpacing: number;
  /** leave out footprints smaller than this (m^2) */
  minFootprint: number;
}

const STEP_KM = 0.03; // ribbons follow the ground at least this closely
const MASK_M = 4; // tree exclusion mask cell

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Growable typed-array builder. */
class F32 {
  a: Float32Array;
  n = 0;
  constructor(cap: number) {
    this.a = new Float32Array(Math.max(16, cap));
  }
  push(...v: number[]) {
    if (this.n + v.length > this.a.length) {
      const b = new Float32Array(Math.max(this.a.length * 2, this.n + v.length));
      b.set(this.a);
      this.a = b;
    }
    for (const x of v) this.a[this.n++] = x;
  }
  done(): Float32Array {
    return this.a.slice(0, this.n);
  }
}

class U32 {
  a: Uint32Array;
  n = 0;
  constructor(cap: number) {
    this.a = new Uint32Array(Math.max(16, cap));
  }
  push(...v: number[]) {
    if (this.n + v.length > this.a.length) {
      const b = new Uint32Array(Math.max(this.a.length * 2, this.n + v.length));
      b.set(this.a);
      this.a = b;
    }
    for (const x of v) this.a[this.n++] = x;
  }
  done(): Uint32Array {
    return this.a.slice(0, this.n);
  }
}

/** Streets as flat ribbons draped on the ground, subdivided so they follow it. */
function ribbons(s: BuildingsData, ground: HeightField): RibbonArrays | null {
  if (!s.count) return null;
  const pos = new F32(s.x.length * 12);
  const shape = new F32(s.x.length * 16);
  const line = new F32(s.x.length * 12);
  const idx = new U32(s.x.length * 12);
  const px: number[] = [];
  const pz: number[] = [];
  for (let b = 0; b < s.count; b++) {
    const style = STREETS[s.height[b]];
    if (!style) continue;
    const half = style.half / 1000;
    const r = s.ringStart[b];
    const v0 = s.vertStart[r];
    const v1 = s.vertStart[r + 1];
    if (v1 - v0 < 2) continue;
    // Austin-Bergstrom's runways are drawn with the airport (Airport.tsx).
    if (s.height[b] === 30 && inAirfield(s.x[v0] / 1000, s.z[v0] / 1000)) continue;
    // Subdivide, so a ribbon never cuts through the terrain between its points.
    px.length = 0;
    pz.length = 0;
    for (let j = v0; j < v1; j++) {
      const x = s.x[j] / 1000;
      const z = s.z[j] / 1000;
      if (j > v0) {
        const ax = px[px.length - 1];
        const az = pz[pz.length - 1];
        const n = Math.ceil(Math.hypot(x - ax, z - az) / STEP_KM);
        for (let k = 1; k < n; k++) {
          px.push(ax + ((x - ax) * k) / n);
          pz.push(az + ((z - az) * k) / n);
        }
      }
      px.push(x);
      pz.push(z);
    }
    const n = px.length;
    // Streets get square caps, so they overlap where they meet; runways and taxiways end flush.
    if (style.look < 3) {
      for (const [i, k] of [
        [0, 1],
        [n - 1, n - 2],
      ]) {
        const dx = px[i] - px[k];
        const dz = pz[i] - pz[k];
        const l = Math.hypot(dx, dz) || 1;
        px[i] += (dx / l) * half;
        pz[i] += (dz / l) * half;
      }
    }
    const base = pos.n / 3;
    let dist = 0;
    for (let i = 0; i < n; i++) {
      if (i) dist += Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
      // Mitred normal: the average of the two segments' normals, lengthened at the corner.
      const a = Math.max(0, i - 1);
      const c = Math.min(n - 1, i + 1);
      let n1x = -(pz[i] - pz[a]);
      let n1z = px[i] - px[a];
      let n2x = -(pz[c] - pz[i]);
      let n2z = px[c] - px[i];
      const l1 = Math.hypot(n1x, n1z);
      const l2 = Math.hypot(n2x, n2z);
      if (l1 > 0) {
        n1x /= l1;
        n1z /= l1;
      }
      if (l2 > 0) {
        n2x /= l2;
        n2z /= l2;
      }
      if (l1 === 0) {
        n1x = n2x;
        n1z = n2z;
      }
      if (l2 === 0) {
        n2x = n1x;
        n2z = n1z;
      }
      let mx = n1x + n2x;
      let mz = n1z + n2z;
      const ml = Math.hypot(mx, mz);
      if (ml < 1e-6) {
        mx = n1x;
        mz = n1z;
      } else {
        mx /= ml;
        mz /= ml;
        const k = 1 / Math.max(0.4, mx * n1x + mz * n1z);
        mx *= k;
        mz *= k;
      }
      const y = elevToY(ground.sample(px[i], pz[i]));
      for (const side of [-1, 1]) {
        pos.push(px[i], y, pz[i]);
        shape.push(mx, mz, side, half);
        line.push(s.height[b], dist, style.lamps);
      }
      if (i) {
        const q = base + (i - 1) * 2;
        idx.push(q, q + 1, q + 3, q, q + 3, q + 2);
      }
    }
  }
  if (!idx.n) return null;
  return { position: pos.done(), shape: shape.done(), line: line.done(), index: idx.done() };
}

/** The lines cars drive along, as drawn (subdivided later by the car layer, which owns heights). */
function lanes(s: BuildingsData): LaneArrays | null {
  const xz: number[] = [];
  const start: number[] = [];
  const cls: number[] = [];
  for (let b = 0; b < s.count; b++) {
    const code = s.height[b] >= LANES_ONLY ? s.height[b] - LANES_ONLY : s.height[b];
    if (!CARS[code]) continue;
    const r = s.ringStart[b];
    const v0 = s.vertStart[r];
    const v1 = s.vertStart[r + 1];
    if (v1 - v0 < 2) continue;
    start.push(xz.length / 2);
    cls.push(code);
    for (let j = v0; j < v1; j++) xz.push(s.x[j] / 1000, s.z[j] / 1000);
  }
  if (!cls.length) return null;
  start.push(xz.length / 2);
  return { xz: new Float32Array(xz), start: new Uint32Array(start), cls: new Uint8Array(cls) };
}

/**
 * Cut a triangle (km) along a grid of `cell`, handing each piece to `emit` as a convex polygon in
 * the triangle's own winding. A neighbouring triangle is cut at the same points along the edge
 * they share, so the pieces meet without cracks.
 */
function gridCut(tri: number[], cell: number, emit: (poly: number[]) => void) {
  const xs = [tri[0], tri[2], tri[4]];
  const zs = [tri[1], tri[3], tri[5]];
  const i0 = Math.floor(Math.min(...xs) / cell);
  const i1 = Math.floor(Math.max(...xs) / cell);
  const j0 = Math.floor(Math.min(...zs) / cell);
  const j1 = Math.floor(Math.max(...zs) / cell);
  // Keep the side of an axis-aligned line (axis 0: x, 1: z) where sign * (v - at) >= 0.
  const clip = (poly: number[], axis: number, at: number, sign: number) => {
    const out: number[] = [];
    const n = poly.length / 2;
    for (let k = 0; k < n; k++) {
      const px = poly[k * 2];
      const pz = poly[k * 2 + 1];
      const q = (k + 1) % n;
      const qx = poly[q * 2];
      const qz = poly[q * 2 + 1];
      const dp = sign * ((axis ? pz : px) - at);
      const dq = sign * ((axis ? qz : qx) - at);
      if (dp >= 0) out.push(px, pz);
      if ((dp >= 0) !== (dq >= 0)) {
        const t = dp / (dp - dq);
        out.push(px + (qx - px) * t, pz + (qz - pz) * t);
      }
    }
    return out;
  };
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      let poly = tri;
      poly = clip(poly, 0, i * cell, 1);
      if (poly.length >= 6) poly = clip(poly, 0, (i + 1) * cell, -1);
      if (poly.length >= 6) poly = clip(poly, 1, j * cell, 1);
      if (poly.length >= 6) poly = clip(poly, 1, (j + 1) * cell, -1);
      if (poly.length >= 6) emit(poly);
    }
  }
}

/** Polygons wider than this (km) are cut along a grid this fine so they lie on the ground: drawn
 * as a few flat triangles, a kilometre-wide apron or car park would have the terrain rise through
 * it. */
const AREA_CELL_KM = 0.04;

/** Parking lots, aprons, pools and ponds as flat polygons on the ground. */
/**
 * An area's kind as drawn: a car park carries the heading of its rows (its longest side's, as
 * lots are laid out along their length), Austin-Bergstrom's general aviation aprons are asphalt.
 * `flat` is its rings (x, z km), the outer one first, `n` points long.
 */
function areaKind(code: number, flat: number[], n: number): number {
  if (code === AREA_PARKING) {
    let best = 0;
    let heading = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dx = flat[j * 2] - flat[i * 2];
      const dz = flat[j * 2 + 1] - flat[i * 2 + 1];
      const l = dx * dx + dz * dz;
      if (l > best) {
        best = l;
        heading = Math.atan2(-dz, dx);
      }
    }
    const deg = ((heading * 180) / Math.PI + 360) % 180;
    return AREA_PARKING_ROWS + Math.round(deg * 10) / 10;
  }
  if (code === AREA_APRON && asphaltApron(flat[0], flat[1])) return AREA_APRON_ASPHALT;
  return code;
}

function flatAreas(a: BuildingsData, ground: HeightField): AreaArrays | null {
  if (!a.count) return null;
  const pos = new F32(a.x.length * 3);
  const kind = new F32(a.x.length);
  const idx = new U32(a.x.length * 3);
  const flat: number[] = [];
  const holes: number[] = [];
  const tri: number[] = [0, 0, 0, 0, 0, 0];
  for (let b = 0; b < a.count; b++) {
    flat.length = 0;
    holes.length = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let r = a.ringStart[b]; r < a.ringStart[b + 1]; r++) {
      if (r > a.ringStart[b]) holes.push(flat.length / 2);
      for (let j = a.vertStart[r]; j < a.vertStart[r + 1]; j++) {
        const x = a.x[j] / 1000;
        const z = a.z[j] / 1000;
        flat.push(x, z);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
    }
    const tris = earcut(flat, holes.length ? holes : undefined, 2);
    if (!tris.length) continue;
    const k = areaKind(a.height[b], flat, holes.length ? holes[0] : flat.length / 2);
    if (Math.max(maxX - minX, maxZ - minZ) <= AREA_CELL_KM) {
      const base = pos.n / 3;
      for (let j = 0; j < flat.length; j += 2) {
        pos.push(flat[j], elevToY(ground.sample(flat[j], flat[j + 1])), flat[j + 1]);
        kind.push(k);
      }
      for (const t of tris) idx.push(base + t);
      continue;
    }
    for (let t = 0; t < tris.length; t += 3) {
      for (let v = 0; v < 3; v++) {
        tri[v * 2] = flat[tris[t + v] * 2];
        tri[v * 2 + 1] = flat[tris[t + v] * 2 + 1];
      }
      gridCut(tri, AREA_CELL_KM, (poly) => {
        const base = pos.n / 3;
        const n = poly.length / 2;
        for (let j = 0; j < n; j++) {
          pos.push(poly[j * 2], elevToY(ground.sample(poly[j * 2], poly[j * 2 + 1])), poly[j * 2 + 1]);
          kind.push(k);
        }
        for (let j = 1; j < n - 1; j++) idx.push(base, base + j, base + j + 1);
      });
    }
  }
  if (!idx.n) return null;
  return { position: pos.done(), kind: kind.done(), index: idx.done() };
}

/** A tile-sized occupancy mask of roofs, streets and paved areas, so trees stand clear of them. */
class Mask {
  readonly n: number;
  readonly cells: Uint8Array;
  constructor(
    readonly x0: number,
    readonly z0: number,
    size: number,
  ) {
    this.n = Math.ceil((size * 1000) / MASK_M);
    this.cells = new Uint8Array(this.n * this.n);
  }

  /** Fill a polygon ring (metres), cell centres by the even-odd rule. */
  polygon(x: Int32Array, z: Int32Array, v0: number, v1: number) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let j = v0; j < v1; j++) {
      minX = Math.min(minX, x[j]);
      maxX = Math.max(maxX, x[j]);
      minZ = Math.min(minZ, z[j]);
      maxZ = Math.max(maxZ, z[j]);
    }
    const ox = this.x0 * 1000;
    const oz = this.z0 * 1000;
    const i0 = Math.max(0, Math.floor((minX - ox) / MASK_M));
    const i1 = Math.min(this.n - 1, Math.floor((maxX - ox) / MASK_M));
    const k0 = Math.max(0, Math.floor((minZ - oz) / MASK_M));
    const k1 = Math.min(this.n - 1, Math.floor((maxZ - oz) / MASK_M));
    for (let k = k0; k <= k1; k++) {
      const cz = oz + (k + 0.5) * MASK_M;
      for (let i = i0; i <= i1; i++) {
        const cx = ox + (i + 0.5) * MASK_M;
        let inside = false;
        for (let j = v0, p = v1 - 1; j < v1; p = j++) {
          if (z[j] > cz !== z[p] > cz && cx < ((x[p] - x[j]) * (cz - z[j])) / (z[p] - z[j]) + x[j]) inside = !inside;
        }
        if (inside) this.cells[k * this.n + i] = 1;
      }
    }
  }

  /** Mark cells within `r` metres of a segment (metres). */
  capsule(ax: number, az: number, bx: number, bz: number, r: number) {
    const ox = this.x0 * 1000;
    const oz = this.z0 * 1000;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - ox) / MASK_M));
    const i1 = Math.min(this.n - 1, Math.floor((Math.max(ax, bx) + r - ox) / MASK_M));
    const k0 = Math.max(0, Math.floor((Math.min(az, bz) - r - oz) / MASK_M));
    const k1 = Math.min(this.n - 1, Math.floor((Math.max(az, bz) + r - oz) / MASK_M));
    const dx = bx - ax;
    const dz = bz - az;
    const ll = dx * dx + dz * dz || 1;
    for (let k = k0; k <= k1; k++) {
      const cz = oz + (k + 0.5) * MASK_M;
      for (let i = i0; i <= i1; i++) {
        const cx = ox + (i + 0.5) * MASK_M;
        const t = Math.min(1, Math.max(0, ((cx - ax) * dx + (cz - az) * dz) / ll));
        const ex = ax + dx * t - cx;
        const ez = az + dz * t - cz;
        if (ex * ex + ez * ez <= r * r) this.cells[k * this.n + i] = 1;
      }
    }
  }

  blocked(x: number, z: number): boolean {
    const i = Math.floor(((x - this.x0) * 1000) / MASK_M);
    const k = Math.floor(((z - this.z0) * 1000) / MASK_M);
    return i < 0 || k < 0 || i >= this.n || k >= this.n || this.cells[k * this.n + i] === 1;
  }
}

/** Small, fast, seedable PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bilinear sample of one byte channel of a region-wide raster, 0..1. */
function channel(data: Uint8Array, w: number, h: number, stride: number, off: number, x: number, z: number): number {
  const u = ((x - X_MIN) / WIDTH_KM) * w - 0.5;
  const v = ((z - Z_MIN) / HEIGHT_KM) * h - 0.5;
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(u)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(v)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, u - x0));
  const fy = Math.max(0, Math.min(1, v - y0));
  const at = (xx: number, yy: number) => data[(yy * w + xx) * stride + off];
  const a = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
  const b = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
  return (a * (1 - fy) + b * fy) / 255;
}

/**
 * Trees over the regional canopy, clear of roofs, streets and water: woods where the land cover
 * says forest, and a scatter of yard and street trees through the neighbourhoods, which the
 * 10 m land cover mostly calls built-up.
 */
function scatterTrees(t: TileData, world: World, o: TileOptions, key: number, seed: number): Float32Array {
  const mask = new Mask(o.x0, o.z0, o.size);
  const bd = t.buildings;
  for (let b = 0; b < bd.count; b++) {
    const r = bd.ringStart[b];
    mask.polygon(bd.x, bd.z, bd.vertStart[r], bd.vertStart[r + 1]);
  }
  const fixed = world.fixedByTile.get(key) ?? [];
  for (let i = 0; i < fixed.length; i += 2) {
    const d = world.fixed[fixed[i]];
    const r = d.ringStart[fixed[i + 1]];
    mask.polygon(d.x, d.z, d.vertStart[r], d.vertStart[r + 1]);
  }
  const ar = t.areas;
  for (let b = 0; b < ar.count; b++) {
    const r = ar.ringStart[b];
    mask.polygon(ar.x, ar.z, ar.vertStart[r], ar.vertStart[r + 1]);
  }
  const st = t.streets;
  for (let b = 0; b < st.count; b++) {
    const style = STREETS[st.height[b]];
    if (!style) continue;
    const r = st.ringStart[b];
    for (let j = st.vertStart[r] + 1; j < st.vertStart[r + 1]; j++) {
      // Runways and taxiways keep a wide clear strip; streets just their kerbs.
      mask.capsule(st.x[j - 1], st.z[j - 1], st.x[j], st.z[j], style.half + (style.look >= 3 ? 60 : 1.5));
    }
  }

  const { surface: sf, density: dn } = world;
  const rand = rng(seed);
  const S = o.treeSpacing / 1000;
  const n = Math.ceil(o.size / S);
  const out = new F32(4096);
  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      const x = o.x0 + (gx + rand()) * S;
      const z = o.z0 + (gz + rand()) * S;
      const pick = rand();
      const size = rand();
      const tint = rand();
      const kindR = rand();
      if (x >= CX_MIN && x <= CX_MAX && z >= CZ_MIN && z <= CZ_MAX) continue; // central Austin has its own
      const sdfM = ((channel(sf.rgba, sf.width, sf.height, 4, 0, x, z) * 255 - 128) / world.sdfLevels) * world.surfPxM;
      if (sdfM > -3) continue; // water and its very edge
      const canopy = channel(sf.rgba, sf.width, sf.height, 4, 2, x, z);
      const park = channel(sf.rgba, sf.width, sf.height, 4, 1, x, z);
      const dens = channel(dn.data, dn.width, dn.height, 1, 0, x, z);
      // The land cover is coarse: "forest" covers half the region, suburbs included, and
      // "shrub" much of the rest. Woods thin out where it's built up; shrubland gets a scatter.
      const forest = smoothstep(0.7, 0.95, canopy);
      const shrub = smoothstep(0.3, 0.5, canopy) * (1 - forest);
      const built = smoothstep(0.05, 0.45, dens);
      // Austin-Bergstrom's airfield is mown: only the woods along its edge stand in it.
      const field = insideField(x, z);
      const woods = field > 0.3 ? 0 : forest * (0.5 - 0.34 * built) + (field > 0 ? 0 : shrub * 0.09);
      const yards = field > 0 ? 0 : 0.1 * smoothstep(0.02, 0.2, dens) * (1 - smoothstep(0.55, 0.9, dens)) * (1 - 0.8 * park);
      const p = Math.min(1, woods + yards);
      if (pick >= p || mask.blocked(x, z)) continue;
      const inWoods = woods > yards;
      const elev = world.elevation.sample(x, z);
      // Ashe juniper ("cedar") in the hill country, bald cypress along the water.
      const coneP = sdfM > -25 ? 0.55 : 0.08 + 0.42 * smoothstep(210, 300, elev);
      const conical = kindR < coneP;
      const radius = (inWoods ? 3.4 + 3.4 * size : 3 + 2.6 * size) * (conical ? 0.8 : 1);
      out.push(x, elevToY(world.ground.sample(x, z)), z, radius, Math.floor(tint * 127.99) + (conical ? 128 : 0));
    }
  }
  return out.done();
}

export function buildTile(t: TileData, world: World, o: TileOptions, key: number): TileMeshes {
  let buildings: BuildingParts | null = null;
  if (t.buildings.count) {
    // (The airport's control tower is modelled with the airport, Airport.tsx.)
    const replaced = (x: number, z: number) => Math.hypot(x - TOWER.site[0], z - TOWER.site[1]) < 0.02;
    const a = extrudeBuildings(t.buildings, world.ground, [], 0, o.minFootprint, replaced);
    if (a.index.length) buildings = { position: a.position, info: a.info, u: a.u, index: a.index };
  }
  return {
    buildings,
    streets: ribbons(t.streets, world.ground),
    areas: flatAreas(t.areas, world.ground),
    lanes: lanes(t.streets),
    trees: scatterTrees(t, world, o, key, key * 2654435761),
  };
}

/** Every buffer in a tile's meshes, to transfer rather than copy. */
export function transferables(m: TileMeshes): ArrayBuffer[] {
  const out: ArrayBuffer[] = [m.trees.buffer as ArrayBuffer];
  if (m.buildings) out.push(...[m.buildings.position, m.buildings.info, m.buildings.u, m.buildings.index].map((a) => a.buffer as ArrayBuffer));
  if (m.streets) out.push(...[m.streets.position, m.streets.shape, m.streets.line, m.streets.index].map((a) => a.buffer as ArrayBuffer));
  if (m.areas) out.push(...[m.areas.position, m.areas.kind, m.areas.index].map((a) => a.buffer as ArrayBuffer));
  if (m.lanes) out.push(...[m.lanes.xz, m.lanes.start, m.lanes.cls].map((a) => a.buffer as ArrayBuffer));
  return out;
}
