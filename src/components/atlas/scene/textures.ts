import * as THREE from "three";
import type { AtlasAssets } from "@/lib/atlas/assets";
import type { Central } from "@/lib/atlas/central";
import { C_HEIGHT_KM, C_WIDTH_KM, HEIGHT_KM, TERRAIN_EXAG, WIDTH_KM } from "@/lib/atlas/geo";

export interface AtlasTextures {
  /** RG half-float: elevation (m), built-up density (0..1). No mips (not renderable everywhere). */
  height: THREE.DataTexture;
  /** RGBA8 terrain normals (exaggerated), mipmapped for clean hillshade when zoomed out */
  normal: THREE.DataTexture;
  /** RGBA8: water SDF, parks */
  surface: THREE.DataTexture;
}

/** RG half-float: elevation (m) and a 0..1 second channel. */
function heightTexture(elev: Float32Array, second: Uint8Array, w: number, h: number): THREE.DataTexture {
  const n = w * h;
  const hf = new Uint16Array(n * 2);
  for (let i = 0; i < n; i++) {
    hf[i * 2] = THREE.DataUtils.toHalfFloat(elev[i]);
    hf[i * 2 + 1] = THREE.DataUtils.toHalfFloat(second[i] / 255);
  }
  const t = new THREE.DataTexture(hf, w, h, THREE.RGFormat, THREE.HalfFloatType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

/** RGBA8 normals from central differences in km, with the mesh's exaggeration. Mipmapped. */
function normalTexture(elev: Float32Array, w: number, h: number, cellX: number, cellZ: number): THREE.DataTexture {
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
  const t = new THREE.DataTexture(nrm, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function surfaceTexture(s: { width: number; height: number; rgba: Uint8Array }): THREE.DataTexture {
  const t = new THREE.DataTexture(s.rgba, s.width, s.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export function makeTextures(a: AtlasAssets): AtlasTextures {
  const { width: w, height: h, data: elev } = a.height;
  return {
    height: heightTexture(elev, a.density, w, h),
    normal: normalTexture(elev, w, h, WIDTH_KM / w, HEIGHT_KM / h),
    surface: surfaceTexture(a.surface),
  };
}

/** Textures for the central detail patch: elevation + canopy, normals, water/park surface. */
export function makeCentralTextures(c: Central): AtlasTextures {
  const { width: w, height: h } = c.meta.terrain;
  return {
    height: heightTexture(c.elev, c.canopy, w, h),
    normal: normalTexture(c.elev, w, h, C_WIDTH_KM / w, C_HEIGHT_KM / h),
    surface: surfaceTexture(c.surface),
  };
}
