import { decodeBuildings, type BuildingsData } from "./buildingsCodec";
import { decodeCentral, type Central, type CentralMeta, type CentralRaw } from "./central";
import { RegionRaster } from "./geo";

export interface Meta {
  terrain: { width: number; height: number; min: number; max: number };
  surface: { width: number; height: number; sdfLevelsPerPx: number };
  central: CentralMeta;
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
}

/** Street-scale detail for central Austin, loaded after the regional map is up. */
export interface CentralAssets {
  central: Central;
  /** every building in central Austin, thinning out beyond it */
  buildings: BuildingsData;
}

const BASE = "/atlas";

async function decodeImage(url: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const blob = await res.blob();
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  } catch {
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(blob);
    });
  }
  const { width, height } = source;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.drawImage(source, 0, 0);
  if ("close" in source) source.close();
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
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

const json = <T,>(name: string) =>
  fetch(`${BASE}/${name}`).then((r) => {
    if (!r.ok) throw new Error(`${name}: ${r.status}`);
    return r.json() as Promise<T>;
  });

const binary = (name: string) =>
  fetch(`${BASE}/${name}`).then((r) => {
    if (!r.ok) throw new Error(`${name}: ${r.status}`);
    return r.arrayBuffer();
  });

/** Progress over parallel loads, each weighted by its rough share of the bytes. */
function progress(onProgress?: (p: number) => void) {
  let done = 0;
  return (w: number) =>
    <T,>(v: T): T => {
      done += w;
      onProgress?.(Math.min(1, done));
      return v;
    };
}

/**
 * The regional map: enough to draw the whole Austin area. Low-power devices get the rasters at
 * half resolution (built by scripts/atlas/build_lowres.py), matching their coarser meshes.
 */
export async function loadAtlasAssets(lowPower: boolean, onProgress?: (p: number) => void): Promise<AtlasAssets> {
  const tick = progress(onProgress);
  const lo = lowPower ? "_lo" : "";
  const [meta, terrain, surface, vectors, buildings] = await Promise.all([
    json<Meta>("meta.json").then(tick(0.01)),
    decodeImage(`${BASE}/terrain${lo}.webp`).then(tick(lowPower ? 0.3 : 0.46)),
    decodeImage(`${BASE}/surface${lo}.webp`).then(tick(lowPower ? 0.35 : 0.4)),
    json<RawVectors>("vectors.json").then(tick(lowPower ? 0.2 : 0.07)),
    binary("buildings.bin").then(decodeBuildings).then(tick(lowPower ? 0.14 : 0.06)),
  ]);

  const n = terrain.width * terrain.height;
  const elev = new Float32Array(n);
  const density = new Uint8Array(n);
  const td = terrain.data;
  for (let i = 0; i < n; i++) {
    elev[i] = (td[i * 4] * 256 + td[i * 4 + 1]) / 10;
    density[i] = td[i * 4 + 2];
  }
  return {
    meta,
    height: new RegionRaster(terrain.width, terrain.height, elev),
    density,
    surface: { width: surface.width, height: surface.height, rgba: new Uint8Array(surface.data.buffer) },
    vectors: decodeVectors(vectors),
    buildings,
  };
}

/** Central Austin's street-scale detail: terrain, surface, paths, trees and every building. */
export async function loadCentralAssets(meta: Meta, lowPower: boolean, onProgress?: (p: number) => void): Promise<CentralAssets> {
  const tick = progress(onProgress);
  const lo = lowPower ? "_lo" : "";
  const [cTerrain, cSurface, cVectors, cTrees, buildings] = await Promise.all([
    decodeImage(`${BASE}/central_terrain${lo}.webp`).then(tick(0.26)),
    decodeImage(`${BASE}/central_surface${lo}.webp`).then(tick(0.41)),
    json<CentralRaw>("central.json").then(tick(0.03)),
    binary("central_trees.bin").then(tick(0.1)),
    binary("central_buildings.bin").then(decodeBuildings).then(tick(0.2)),
  ]);
  return { central: decodeCentral(meta.central, cTerrain, cSurface, cVectors, cTrees), buildings };
}
