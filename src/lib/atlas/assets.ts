import { decodeBuildings, type BuildingsData } from "./buildingsCodec";
import { decodeCentral, type Central, type CentralMeta, type CentralRaw } from "./central";
import { RegionRaster } from "./geo";
import { atlasFiles } from "./files";
import { mark } from "./perf";

export interface Meta {
  terrain: { width: number; height: number; min: number; max: number };
  surface: { width: number; height: number; sdfLevelsPerPx: number };
  central: CentralMeta;
  /** the landscape beyond the map (scripts/atlas/build_outer.py) */
  outer?: {
    /** x, z of its north-west corner and its width and height, scene km */
    bounds: [number, number, number, number];
    width: number;
    height: number;
    sdfLevelsPerPx: number;
    /** towns around the map: x, z (km), population */
    towns: [number, number, number][];
  };
}

/** The landscape beyond the map: coarse relief and water all round it. */
export interface OuterAssets {
  width: number;
  height: number;
  /** metres */
  elev: Float32Array;
  /** water signed distance, as stored: 128 at the shore, sdfLevelsPerPx per pixel, + on water */
  sdf: Uint8Array;
}

/** A decoded polyline: x,z pairs in km. */
export type Polyline = Float32Array;

export interface LabelPoint {
  text: string;
  x: number; // km
  z: number; // km
  rank?: number;
  kind?: string;
}

export interface Station {
  name: string;
  x: number;
  z: number;
  /** 0..1 along the Red Line */
  at: number;
}

export interface Vectors {
  roads: Record<"motorway" | "trunk" | "primary" | "secondary" | "tertiary", Polyline[]>;
  rail: Polyline[];
  redLine: { line: Polyline; stations: Station[] };
  creeks: Polyline[];
  labels: {
    towns: LabelPoint[];
    neighborhoods: LabelPoint[];
    water: LabelPoint[];
    landmarks: LabelPoint[];
    shields: LabelPoint[];
  };
}


export interface AtlasAssets {
  meta: Meta;
  height: RegionRaster; // metres
  density: Uint8Array; // same grid as height
  surface: { width: number; height: number; rgba: Uint8Array };
  vectors: Vectors;
  buildings: BuildingsData;
  outer: OuterAssets | null;
}

/** Street-scale detail for central Austin, loaded after the regional map is up. */
export interface CentralAssets {
  central: Central;
  /** every building in central Austin, thinning out beyond it */
  buildings: BuildingsData;
}

const BASE = "/atlas";

/** Decode a WebP (or PNG) to RGBA pixels: in the prep worker, or on the main thread as a fallback. */
async function decodeImage(buf: ArrayBuffer, name: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const blob = new Blob([buf], { type: name.endsWith(".png") ? "image/png" : "image/webp" });
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  } catch {
    // Browsers without createImageBitmap's options (main thread only).
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(blob);
    });
  }
  const { width, height } = source;
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (typeof OffscreenCanvas !== "undefined") {
    ctx = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true });
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.drawImage(source, 0, 0);
  if ("close" in source) source.close();
  const data = ctx.getImageData(0, 0, width, height).data;
  mark(`decoded ${name}`);
  return { width, height, data };
}

function decodeLine(enc: number[]): Polyline {
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

function kmLabel<T extends { x: number; z: number }>(l: T): T {
  return { ...l, x: l.x / 1000, z: l.z / 1000 };
}

interface RawVectors {
  roads: Record<string, number[][]>;
  rail: number[][];
  redLine: { line: number[]; stations: Station[] };
  creeks: number[][];
  labels: Record<string, LabelPoint[]>;
}

function decodeVectors(raw: RawVectors): Vectors {
  const roads = Object.fromEntries(
    Object.entries(raw.roads).map(([k, lines]) => [k, lines.map(decodeLine)]),
  ) as Vectors["roads"];
  const labels = Object.fromEntries(
    Object.entries(raw.labels).map(([k, list]) => [k, list.map(kmLabel)]),
  ) as Vectors["labels"];
  return {
    roads,
    rail: raw.rail.map(decodeLine),
    redLine: { line: decodeLine(raw.redLine.line), stations: raw.redLine.stations.map(kmLabel) },
    creeks: raw.creeks.map(decodeLine),
    labels,
  };
}

type FileSet = ReturnType<typeof atlasFiles>;
/** The regional map's files as fetched; the country beyond the map (outer) may be missing. */
export type RegionalFiles = Record<keyof FileSet["regional"], ArrayBuffer | null>;
export type CentralFiles = Record<keyof FileSet["central"], ArrayBuffer>;

/** Rough shares of the bytes, for the progress bar. */
const REGIONAL_WEIGHTS: Record<keyof FileSet["regional"], number> = {
  meta: 0.01,
  terrain: 0.36,
  surface: 0.3,
  vectors: 0.07,
  buildings: 0.08,
  outer: 0.18,
};
const CENTRAL_WEIGHTS: Record<keyof FileSet["central"], number> = {
  terrain: 0.22,
  surface: 0.34,
  data: 0.03,
  trees: 0.09,
  buildings: 0.32,
};

/**
 * A file's bytes, tried up to three times: a network error or a server error (5xx, 429) is often
 * gone a moment later, and one lost file would otherwise sink the whole map.
 */
async function fetchBytes(url: string, tries = 3): Promise<ArrayBuffer> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((r) => setTimeout(r, 400 * 3 ** (i - 1)));
    try {
      const r = await fetch(url);
      if (r.ok) return await r.arrayBuffer();
      last = new Error(`${url}: ${r.status}`);
      if (r.status < 500 && r.status !== 429) break;
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

async function fetchAll<K extends string>(
  names: Record<K, string>,
  weights: Record<K, number>,
  optional: K[],
  onProgress?: (p: number) => void,
): Promise<Record<K, ArrayBuffer | null>> {
  let done = 0;
  const keys = Object.keys(names) as K[];
  const bufs = await Promise.all(
    keys.map((k) =>
      fetchBytes(`${BASE}/${names[k]}`)
        .catch((err) => {
          if (optional.includes(k)) return null;
          throw err;
        })
        .then((b) => {
          mark(`got ${names[k]}`);
          done += weights[k];
          onProgress?.(Math.min(1, done));
          return b;
        }),
    ),
  );
  return Object.fromEntries(keys.map((k, i) => [k, bufs[i]])) as Record<K, ArrayBuffer | null>;
}

/** Fetch the regional map's files (decoded by decodeAtlasAssets). */
export function fetchRegionalFiles(lowPower: boolean, onProgress?: (p: number) => void): Promise<RegionalFiles> {
  // The country beyond the map is scenery: without it the map still works, edge and all.
  return fetchAll<keyof FileSet["regional"]>(atlasFiles(lowPower).regional, REGIONAL_WEIGHTS, ["outer"], onProgress);
}

/** Fetch central Austin's files (decoded by decodeCentralAssets). */
export function fetchCentralFiles(lowPower: boolean, onProgress?: (p: number) => void): Promise<CentralFiles> {
  return fetchAll<keyof FileSet["central"]>(atlasFiles(lowPower).central, CENTRAL_WEIGHTS, [], onProgress) as Promise<CentralFiles>;
}

const text = (buf: ArrayBuffer | null) => new TextDecoder().decode(buf ?? new ArrayBuffer(0));

/** The regional map, decoded: enough to draw the whole Austin area. */
export async function decodeAtlasAssets(f: RegionalFiles): Promise<AtlasAssets> {
  const meta = JSON.parse(text(f.meta)) as Meta;
  const [terrain, surface, outerImg] = await Promise.all([
    decodeImage(f.terrain!, "terrain.webp"),
    decodeImage(f.surface!, "surface.webp"),
    f.outer ? decodeImage(f.outer, "outer.webp").catch(() => null) : Promise.resolve(null),
  ]);
  const n = terrain.width * terrain.height;
  const elev = new Float32Array(n);
  const density = new Uint8Array(n);
  const td = terrain.data;
  for (let i = 0; i < n; i++) {
    elev[i] = (td[i * 4] * 256 + td[i * 4 + 1]) / 10;
    density[i] = td[i * 4 + 2];
  }
  let outer: OuterAssets | null = null;
  if (outerImg && meta.outer) {
    const m = outerImg.width * outerImg.height;
    const oe = new Float32Array(m);
    const os = new Uint8Array(m);
    const od = outerImg.data;
    for (let i = 0; i < m; i++) {
      oe[i] = (od[i * 4] * 256 + od[i * 4 + 1]) / 10;
      os[i] = od[i * 4 + 2];
    }
    outer = { width: outerImg.width, height: outerImg.height, elev: oe, sdf: os };
  }
  return {
    meta,
    height: new RegionRaster(terrain.width, terrain.height, elev),
    density,
    surface: { width: surface.width, height: surface.height, rgba: new Uint8Array(surface.data.buffer) },
    vectors: decodeVectors(JSON.parse(text(f.vectors)) as RawVectors),
    buildings: decodeBuildings(f.buildings!),
    outer,
  };
}

/** Central Austin's street-scale detail, decoded: terrain, surface, paths, trees and every building. */
export async function decodeCentralAssets(meta: Meta, f: CentralFiles): Promise<CentralAssets> {
  const [cTerrain, cSurface] = await Promise.all([
    decodeImage(f.terrain, "central_terrain.webp"),
    decodeImage(f.surface, "central_surface.webp"),
  ]);
  const raw = JSON.parse(text(f.data)) as CentralRaw;
  return { central: decodeCentral(meta.central, cTerrain, cSurface, raw, f.trees), buildings: decodeBuildings(f.buildings) };
}
