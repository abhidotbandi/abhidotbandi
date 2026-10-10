import * as THREE from "three";
import type { AtlasAssets } from "../assets";
import type { Central } from "../central";
import { C_HEIGHT_KM, C_WIDTH_KM, HEIGHT_KM, TERRAIN_EXAG, WIDTH_KM } from "../geo";

// The terrain textures' pixels, computed off the main thread (see prep/worker.ts) and wrapped as
// GPU textures in scene/textures.ts.

export interface Pixels<T extends Uint8Array | Uint16Array = Uint8Array | Uint16Array> {
  width: number;
  height: number;
  data: T;
}

export interface TerrainPixels {
  /** RG half-float: elevation (m), and a 0..1 second channel (built-up density or canopy) */
  height: Pixels<Uint16Array>;
  /** RGBA8 terrain normals, with the mesh's exaggeration */
  normal: Pixels<Uint8Array>;
  /** RGBA8: water SDF, parks, density */
  surface?: Pixels<Uint8Array>;
  /** the landscape beyond the map */
  outer?: { height: Pixels<Uint16Array>; normal: Pixels<Uint8Array> };
}

/** RG half-float: elevation (m) and a 0..1 second channel. */
function heightPixels(elev: Float32Array, second: Uint8Array, w: number, h: number): Pixels<Uint16Array> {
  const n = w * h;
  const hf = new Uint16Array(n * 2);
  for (let i = 0; i < n; i++) {
    hf[i * 2] = THREE.DataUtils.toHalfFloat(elev[i]);
    hf[i * 2 + 1] = THREE.DataUtils.toHalfFloat(second[i] / 255);
  }
  return { width: w, height: h, data: hf };
}

/** RGBA8 normals from central differences in km, with the mesh's exaggeration. */
function normalPixels(elev: Float32Array, w: number, h: number, cellX: number, cellZ: number): Pixels<Uint8Array> {
  const nrm = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(w - 1, x + 1);
      const dhdx = ((elev[y * w + x1] - elev[y * w + x0]) / 1000 / ((x1 - x0) * cellX)) * TERRAIN_EXAG;
      const dhdz = ((elev[y1 * w + x] - elev[y0 * w + x]) / 1000 / ((y1 - y0) * cellZ)) * TERRAIN_EXAG;
      const inv = 1 / Math.hypot(dhdx, 1, dhdz);
      const o = (y * w + x) * 4;
      nrm[o] = (-dhdx * inv * 0.5 + 0.5) * 255;
      nrm[o + 1] = (inv * 0.5 + 0.5) * 255;
      nrm[o + 2] = (-dhdz * inv * 0.5 + 0.5) * 255;
      nrm[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: nrm };
}

/** The regional map's terrain textures (and the country's beyond it). */
export function regionalPixels(a: AtlasAssets): TerrainPixels {
  const { width: w, height: h, data: elev } = a.height;
  const o = a.outer;
  const ob = a.meta.outer?.bounds;
  return {
    height: heightPixels(elev, a.density, w, h),
    normal: normalPixels(elev, w, h, WIDTH_KM / w, HEIGHT_KM / h),
    surface: { width: a.surface.width, height: a.surface.height, data: a.surface.rgba },
    outer:
      o && ob
        ? {
            height: heightPixels(o.elev, o.sdf, o.width, o.height),
            normal: normalPixels(o.elev, o.width, o.height, ob[2] / o.width, ob[3] / o.height),
          }
        : undefined,
  };
}

/** The central patch's: elevation + canopy, normals, water/park surface. */
export function centralPixels(c: Central): TerrainPixels {
  const { width: w, height: h } = c.meta.terrain;
  return {
    height: heightPixels(c.elev, c.canopy, w, h),
    normal: normalPixels(c.elev, w, h, C_WIDTH_KM / w, C_HEIGHT_KM / h),
    surface: { width: c.surface.width, height: c.surface.height, data: c.surface.rgba },
  };
}
