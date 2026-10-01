import { SITES, SITE_BY_ID } from "@/data/atlas/companies";
import type { AtlasAssets, CentralAssets } from "../assets";
import type { BuildingsData } from "../buildingsCodec";
import { capitolClearings, isCapitolSkylight } from "../capitol";
import { MODELLED_LANDMARKS, buildPatchGrid, clearTrees, type Central, type Trees } from "../central";
import { districtStyle } from "../districtStyle";
import { extrudeBuildings, type BuildingArrays } from "../extrude";
import { BaseMeshField, C_HEIGHT_KM, C_WIDTH_KM, Ground } from "../geo";
import { mark } from "../perf";
import { pointInPoly } from "../polygon";
import { MODELLED_SITES, buildSiteModelArrays, type SiteModelArrays } from "../siteModels";
import { centralPixels, regionalPixels, type TerrainPixels } from "./textureData";

// Everything the scene needs computed from the data before it can draw: textures' pixels, the
// ground under the patch, every building extruded, the company sites modelled, the trees placed.
// Plain arrays only, so it can run in the prep worker (prep/worker.ts) and be handed over
// without copying; scene/prepare.ts wraps the result in three.js objects.

const siteIndex = (id: string) => SITE_BY_ID.get(id)?.index ?? -1;

export interface RegionalPrep {
  assets: AtlasAssets;
  pixels: TerrainPixels;
  buildings: BuildingArrays;
  /** terrain grid resolution (segments across) */
  terrainSegments: number;
  lowPower: boolean;
}

export interface CentralPrep {
  central: Central;
  /** central Austin's footprints, which the detail tiles' trees keep clear of */
  footprints: BuildingsData;
  pixels: TerrainPixels;
  patch: { nx: number; nz: number; data: Float32Array };
  buildings: BuildingArrays;
  /** the buildings 12 m and up, which the lakes mirror (desktop only) */
  skyline: BuildingArrays | null;
  models: SiteModelArrays;
  /** the patch's trees, clear of the site models' plant and the Capitol's walks and monuments */
  trees: Trees;
  /** the water's surface level (m) in cells across the patch, NaN where there's none */
  water: WaterLevels;
}

/** Water surface levels over the central patch, for the lake's reflections (scene/Water.tsx). */
export interface WaterLevels {
  nx: number;
  nz: number;
  /** cell size, km */
  cell: number;
  /** metres above sea level, per cell (row-major, north to south), NaN where there's no water */
  level: Float32Array;
}

/**
 * The level of the water in each ~250 m cell of the patch: the median of the terrain's
 * elevation under the water there. Lady Bird Lake and Lake Austin sit at different levels
 * either side of Tom Miller Dam, and the creeks below them, so reflections need to know which.
 */
function waterLevels(c: Central): WaterLevels {
  const { width: sw, height: sh, rgba } = c.surface;
  const tw = c.meta.terrain.width;
  const th = c.meta.terrain.height;
  const cell = 0.25;
  const nx = Math.ceil(C_WIDTH_KM / cell);
  const nz = Math.ceil(C_HEIGHT_KM / cell);
  const buckets: number[][] = Array.from({ length: nx * nz }, () => []);
  const step = 3;
  for (let v = 0; v < sh; v += step) {
    for (let u = 0; u < sw; u += step) {
      // Well inside the water (>= ~2 m from the bank), where the terrain is the water's surface.
      if (rgba[(v * sw + u) * 4] < 140) continue;
      const fx = (u + 0.5) / sw;
      const fz = (v + 0.5) / sh;
      const e = c.elev[Math.min(th - 1, Math.floor(fz * th)) * tw + Math.min(tw - 1, Math.floor(fx * tw))];
      buckets[Math.min(nz - 1, Math.floor((fz * C_HEIGHT_KM) / cell)) * nx + Math.min(nx - 1, Math.floor((fx * C_WIDTH_KM) / cell))].push(e);
    }
  }
  const level = new Float32Array(nx * nz).fill(Number.NaN);
  buckets.forEach((b, i) => {
    if (b.length < 6) return;
    b.sort((p, q) => p - q);
    level[i] = b[b.length >> 1];
  });
  return { nx, nz, cell, level };
}

/** Each footprint's outer ring (flat x, z km). */
function outerRings(d: BuildingsData): number[][] {
  const out: number[][] = [];
  for (let b = 0; b < d.count; b++) {
    const r: number[] = [];
    for (let v = d.vertStart[d.ringStart[b]]; v < d.vertStart[d.ringStart[b] + 1]; v++) r.push(d.x[v] / 1000, d.z[v] / 1000);
    out.push(r);
  }
  return out;
}

/** The regional map: its textures and its buildings (the modelled sites left out). */
export function computeRegional(assets: AtlasAssets, lowPower: boolean): RegionalPrep {
  const pixels = regionalPixels(assets);
  mark("regional textures");
  const terrainSegments = lowPower ? 320 : 560;
  // Objects and the patch edge follow the surface the base mesh draws, not the raster.
  const ground = new Ground(new BaseMeshField(assets.height, terrainSegments), null);
  const modelled = new Set(MODELLED_SITES.map(siteIndex));
  const buildings = extrudeBuildings(
    assets.buildings,
    ground,
    assets.buildings.sites.map(siteIndex),
    SITES.length,
    lowPower ? 120 : 0,
    (_x, _z, site) => modelled.has(site),
  );
  mark("regional buildings");
  return { assets, pixels, buildings, terrainSegments, lowPower };
}

/** Central Austin: the patch's ground and textures, its buildings, every site's model, the trees. */
export function computeCentral(r: Pick<RegionalPrep, "assets" | "terrainSegments" | "lowPower">, c: CentralAssets): CentralPrep {
  const base = new BaseMeshField(r.assets.height, r.terrainSegments);
  // ~16 m mesh cells on desktop (the DEM is ~8 m), ~28 m on phones.
  const patch = buildPatchGrid(c.central, base, r.lowPower ? 0.028 : 0.016);
  const ground = new Ground(base, patch);
  mark("central patch");
  // The Capitol, the Tower and the other modelled landmarks drop their plain extrusions (the
  // Capitol Extension's skylights too), as do the company sites modelled in their place.
  const landmarks = MODELLED_LANDMARKS.flatMap((k) => c.central.landmarks[k]?.outline ?? []);
  const sites = new Set(MODELLED_SITES.map(siteIndex));
  const skip = (x: number, z: number, site: number) =>
    sites.has(site) || landmarks.some((o) => pointInPoly(o, x, z)) || isCapitolSkylight(x, z);
  const siteMap = c.buildings.sites.map(siteIndex);
  const buildings = extrudeBuildings(c.buildings, ground, siteMap, SITES.length, r.lowPower ? 120 : 0, skip, districtStyle);
  // The lakes mirror only what stands tall enough to show in them: a small mesh of its own, so
  // the reflection doesn't draw the whole city again.
  const skyline = r.lowPower ? null : extrudeBuildings(c.buildings, ground, siteMap, SITES.length, 0, skip, districtStyle, 12);
  mark("central buildings");
  const models = buildSiteModelArrays([r.assets.buildings, c.buildings], ground, SITES.length);
  mark("central models");
  const pixels = centralPixels(c.central);
  const trees = clearTrees(c.central.trees, [...outerRings(models.clearings), ...capitolClearings()]);
  const water = waterLevels(c.central);
  mark("central textures");
  return {
    central: c.central,
    footprints: c.buildings,
    pixels,
    patch: { nx: patch.nx, nz: patch.nz, data: patch.data },
    buildings,
    skyline,
    models,
    trees,
    water,
  };
}

/** The sites' models on the regional map alone, for when central Austin's detail can't load. */
export function computeRegionalModels(r: Pick<RegionalPrep, "assets" | "terrainSegments">): SiteModelArrays {
  const ground = new Ground(new BaseMeshField(r.assets.height, r.terrainSegments), null);
  return buildSiteModelArrays([r.assets.buildings], ground, SITES.length);
}

/** The distinct buffers under every typed array in a value, to hand over without copying. */
export function transferables(value: unknown, keep: Set<ArrayBuffer> = new Set()): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  const seen = new Set<unknown>();
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (ArrayBuffer.isView(v)) {
      const b = v.buffer;
      if (b instanceof ArrayBuffer && !keep.has(b) && b.byteLength) out.add(b);
      return;
    }
    for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x);
  };
  walk(value);
  return [...out];
}
