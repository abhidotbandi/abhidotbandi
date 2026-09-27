// Central Austin detail patch: decoded data from scripts/atlas/build_central.py.

import type { Polyline } from "./assets";
import {
  CX_MAX,
  CX_MIN,
  CZ_MAX,
  CZ_MIN,
  C_HEIGHT_KM,
  C_WIDTH_KM,
  PatchGrid,
  type HeightField,
} from "./geo";

/** Landmark footprints drawn as models (scene/Landmarks.tsx) instead of plain extrusions. */
export const MODELLED_LANDMARKS = [
  "capitol",
  "ut-tower",
  "frost-bank-tower",
  "the-independent",
  "block-185",
  "dkr-stadium",
  "moody-center",
] as const;

export interface CentralMeta {
  bounds: [number, number, number, number];
  terrain: { width: number; height: number };
  surface: { width: number; height: number; sdfK: number };
  trees: number;
}

export interface TrailEdge {
  a: number;
  b: number;
  /** 0 trail, 1 boardwalk or bridge on the trail, 2 road-bridge sidewalk or pedestrian bridge */
  kind: number;
  line: Polyline;
  /** km */
  length: number;
}

export interface Dock {
  id: string;
  name: string;
  kind: "paddle" | "rowing" | "canoe" | "riverboat";
  x: number;
  z: number;
}

export interface River {
  line: Polyline;
  /** distance from the centreline to the nearest shore at each vertex, km */
  half: Float32Array;
}

export interface Central {
  meta: CentralMeta;
  /** terrain grid (~8 m): elevation in metres and tree canopy 0..255 */
  elev: Float32Array;
  canopy: Uint8Array;
  surface: { width: number; height: number; rgba: Uint8Array };
  paths: Record<string, Polyline[]>;
  trails: { nodes: Float32Array; edges: TrailEdge[] };
  bridges: { name: string; cls: string; line: Polyline }[];
  piers: { polys: Polyline[]; lines: Polyline[] };
  train: Polyline[];
  rivers: Record<"ladybird" | "austin" | "barton", River | undefined>;
  streets: Record<"rainey" | "sixth" | "congress" | "soco", Polyline[]>;
  moonlight: [number, number][];
  docks: Dock[];
  pools: Polyline[];
  lawns: Polyline[];
  landmarks: Record<string, { outline: Polyline; height: number | null }>;
  trees: Trees;
}

export interface Trees {
  count: number;
  /** scene km */
  x: Float32Array;
  z: Float32Array;
  /** crown radius, km */
  r: Float32Array;
  /** bit 7 = conical (cypress, juniper); low bits = tint 0..127 */
  v: Uint8Array;
}

export interface CentralRaw {
  paths: Record<string, number[][]>;
  trails: { nodes: [number, number][]; edges: [number, number, number, number[]][] };
  bridges: { name: string; cls: string; line: number[] }[];
  piers: { polys: number[][]; lines: number[][] };
  train: number[][];
  rivers: Record<string, { line: number[]; half: number[] }>;
  streets: Record<string, number[][]>;
  moonlight: [number, number][];
  docks: { id: string; name: string; kind: Dock["kind"]; x: number; z: number }[];
  pools: number[][];
  lawns: number[][];
  landmarks: Record<string, { outline: number[]; height: number | null }>;
}

export function decodeLine(enc: number[]): Polyline {
  const out = new Float32Array(enc.length);
  let x = 0;
  let z = 0;
  for (let i = 0; i < enc.length; i += 2) {
    x += enc[i];
    z += enc[i + 1];
    out[i] = x / 1000;
    out[i + 1] = z / 1000;
  }
  return out;
}

export function lineLength(l: Polyline): number {
  let d = 0;
  for (let i = 2; i < l.length; i += 2) d += Math.hypot(l[i] - l[i - 2], l[i + 1] - l[i - 1]);
  return d;
}

function decodeTrees(buf: ArrayBuffer): Trees {
  const n = Math.floor(buf.byteLength / 6);
  const dv = new DataView(buf);
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const r = new Float32Array(n);
  const v = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    x[i] = CX_MIN + dv.getUint16(o, true) / 4000;
    z[i] = CZ_MIN + dv.getUint16(o + 2, true) / 4000;
    r[i] = dv.getUint8(o + 4) / 10000;
    v[i] = dv.getUint8(o + 5);
  }
  return { count: n, x, z, r, v };
}

export function decodeCentral(
  meta: CentralMeta,
  terrain: { width: number; height: number; data: Uint8ClampedArray },
  surface: { width: number; height: number; data: Uint8ClampedArray },
  raw: CentralRaw,
  trees: ArrayBuffer,
): Central {
  const n = terrain.width * terrain.height;
  const elev = new Float32Array(n);
  const canopy = new Uint8Array(n);
  const td = terrain.data;
  for (let i = 0; i < n; i++) {
    elev[i] = (td[i * 4] * 256 + td[i * 4 + 1]) / 10;
    canopy[i] = td[i * 4 + 2];
  }
  const lines = (list: number[][]) => list.map(decodeLine);
  const nodes = new Float32Array(raw.trails.nodes.length * 2);
  raw.trails.nodes.forEach(([x, z], i) => {
    nodes[i * 2] = x / 1000;
    nodes[i * 2 + 1] = z / 1000;
  });
  const river = (r?: { line: number[]; half: number[] }): River | undefined =>
    r && { line: decodeLine(r.line), half: Float32Array.from(r.half, (m) => m / 1000) };
  return {
    meta,
    elev,
    canopy,
    surface: { width: surface.width, height: surface.height, rgba: new Uint8Array(surface.data.buffer) },
    paths: Object.fromEntries(Object.entries(raw.paths).map(([k, v]) => [k, lines(v)])),
    trails: {
      nodes,
      edges: raw.trails.edges.map(([a, b, kind, e]) => {
        const line = decodeLine(e);
        return { a, b, kind, line, length: lineLength(line) };
      }),
    },
    bridges: raw.bridges.map((b) => ({ name: b.name, cls: b.cls, line: decodeLine(b.line) })),
    piers: { polys: lines(raw.piers.polys), lines: lines(raw.piers.lines) },
    train: lines(raw.train),
    rivers: {
      ladybird: river(raw.rivers.ladybird),
      austin: river(raw.rivers.austin),
      barton: river(raw.rivers.barton),
    },
    streets: {
      rainey: lines(raw.streets.rainey ?? []),
      sixth: lines(raw.streets.sixth ?? []),
      congress: lines(raw.streets.congress ?? []),
      soco: lines(raw.streets.soco ?? []),
    },
    moonlight: raw.moonlight.map(([x, z]) => [x / 1000, z / 1000]),
    docks: raw.docks.map((d) => ({ ...d, x: d.x / 1000, z: d.z / 1000 })),
    pools: lines(raw.pools),
    lawns: lines(raw.lawns),
    landmarks: Object.fromEntries(
      Object.entries(raw.landmarks).map(([k, v]) => [k, { outline: decodeLine(v.outline), height: v.height }]),
    ),
    trees: decodeTrees(trees),
  };
}

/** Elevation (m) of the patch DEM at scene coordinates, bilinear on texel centres. */
export function sampleCentralElev(c: Central, x: number, z: number): number {
  const w = c.meta.terrain.width;
  const h = c.meta.terrain.height;
  const u = ((x - CX_MIN) / C_WIDTH_KM) * w - 0.5;
  const v = ((z - CZ_MIN) / C_HEIGHT_KM) * h - 0.5;
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(u)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(v)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, u - x0));
  const fy = Math.max(0, Math.min(1, v - y0));
  const d = c.elev;
  const a = d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx;
  const b = d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx;
  return a * (1 - fy) + b * fy;
}

/** Width of the band (km) along the patch edge where it blends into the base terrain. */
export const PATCH_BLEND_KM = 0.25;

/** Mesh-resolution heights for the patch, blended into the base terrain near its edges. */
export function buildPatchGrid(c: Central, base: HeightField, cellKm: number): PatchGrid {
  const nx = Math.round(C_WIDTH_KM / cellKm) + 1;
  const nz = Math.round(C_HEIGHT_KM / cellKm) + 1;
  const data = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const z = CZ_MIN + (j / (nz - 1)) * C_HEIGHT_KM;
    for (let i = 0; i < nx; i++) {
      const x = CX_MIN + (i / (nx - 1)) * C_WIDTH_KM;
      const d = Math.min(x - CX_MIN, CX_MAX - x, z - CZ_MIN, CZ_MAX - z);
      const t = Math.max(0, Math.min(1, d / PATCH_BLEND_KM));
      const w = t * t * (3 - 2 * t);
      const hb = base.sample(x, z);
      data[j * nx + i] = w > 0 ? hb + (sampleCentralElev(c, x, z) - hb) * w : hb;
    }
  }
  return new PatchGrid(nx, nz, data);
}

/** Signed distance to water (km, + on water) from the patch surface raster. */
export function sampleWaterKm(c: Central, x: number, z: number): number {
  const { width: w, height: h, rgba } = c.surface;
  const u = Math.round(((x - CX_MIN) / C_WIDTH_KM) * w - 0.5);
  const v = Math.round(((z - CZ_MIN) / C_HEIGHT_KM) * h - 0.5);
  if (u < 0 || v < 0 || u >= w || v >= h) return -1;
  const e = rgba[(v * w + u) * 4] - 128;
  const m = Math.sign(e) * (Math.abs(e) / c.meta.surface.sdfK) ** 2;
  return m / 1000;
}

/** Tree canopy 0..1 from the patch terrain raster. */
export function sampleCanopy(c: Central, x: number, z: number): number {
  const w = c.meta.terrain.width;
  const h = c.meta.terrain.height;
  const u = Math.round(((x - CX_MIN) / C_WIDTH_KM) * w - 0.5);
  const v = Math.round(((z - CZ_MIN) / C_HEIGHT_KM) * h - 0.5);
  if (u < 0 || v < 0 || u >= w || v >= h) return 0;
  return c.canopy[v * w + u] / 255;
}

export function inCentral(x: number, z: number, margin = 0): boolean {
  return x >= CX_MIN - margin && x <= CX_MAX + margin && z >= CZ_MIN - margin && z <= CZ_MAX + margin;
}
