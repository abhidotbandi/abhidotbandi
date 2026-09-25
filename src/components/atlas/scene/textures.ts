import * as THREE from "three";
import type { AtlasAssets } from "@/lib/atlas/assets";
import { HEIGHT_KM, TERRAIN_EXAG, WIDTH_KM } from "@/lib/atlas/geo";

export interface AtlasTextures {
  /** RG half-float: elevation (m), built-up density (0..1). No mips (not renderable everywhere). */
  height: THREE.DataTexture;
  /** RGBA8 terrain normals (exaggerated), mipmapped for clean hillshade when zoomed out */
  normal: THREE.DataTexture;
  /** RGBA8: water SDF, parks */
  surface: THREE.DataTexture;
}

export function makeTextures(a: AtlasAssets): AtlasTextures {
  const { width: w, height: h, data: elev } = a.height;
  const n = w * h;

  const hf = new Uint16Array(n * 2);
  for (let i = 0; i < n; i++) {
    hf[i * 2] = THREE.DataUtils.toHalfFloat(elev[i]);
    hf[i * 2 + 1] = THREE.DataUtils.toHalfFloat(a.density[i] / 255);
  }
  const height = new THREE.DataTexture(hf, w, h, THREE.RGFormat, THREE.HalfFloatType);
  height.minFilter = THREE.LinearFilter;
  height.magFilter = THREE.LinearFilter;
  height.wrapS = height.wrapT = THREE.ClampToEdgeWrapping;
  height.needsUpdate = true;

  // Central differences in km, with the same exaggeration the mesh uses.
  const cellX = WIDTH_KM / w;
  const cellZ = HEIGHT_KM / h;
  const nrm = new Uint8Array(n * 4);
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
  const normal = new THREE.DataTexture(nrm, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  normal.generateMipmaps = true;
  normal.minFilter = THREE.LinearMipmapLinearFilter;
  normal.magFilter = THREE.LinearFilter;
  normal.anisotropy = 4;
  normal.needsUpdate = true;

  const s = a.surface;
  const surface = new THREE.DataTexture(s.rgba, s.width, s.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  surface.generateMipmaps = true;
  surface.minFilter = THREE.LinearMipmapLinearFilter;
  surface.magFilter = THREE.LinearFilter;
  surface.anisotropy = 4;
  surface.needsUpdate = true;

  return { height, normal, surface };
}
