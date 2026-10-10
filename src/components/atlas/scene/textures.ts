import * as THREE from "three";
import type { Pixels, TerrainPixels } from "@/lib/atlas/prep/textureData";

export interface AtlasTextures {
  /** RG half-float: elevation (m), built-up density (0..1). No mips (not renderable everywhere). */
  height: THREE.DataTexture;
  /** RGBA8 terrain normals (exaggerated), mipmapped for clean hillshade when zoomed out */
  normal: THREE.DataTexture;
  /** RGBA8: water SDF, parks */
  surface: THREE.DataTexture;
  /** the landscape beyond the map: RG half-float (elevation m, water distance as stored / 255), normals */
  outer?: { height: THREE.DataTexture; normal: THREE.DataTexture };
}

/** RG half-float elevation (and a second channel). No mips (not renderable everywhere). */
function heightTexture(p: Pixels<Uint16Array>): THREE.DataTexture {
  const t = new THREE.DataTexture(p.data, p.width, p.height, THREE.RGFormat, THREE.HalfFloatType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

/** RGBA8, mipmapped: normals (clean hillshade when zoomed out) and the surface. */
function rgbaTexture(p: Pixels<Uint8Array>): THREE.DataTexture {
  const t = new THREE.DataTexture(p.data, p.width, p.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** The terrain's textures, from pixels computed off the main thread (prep/textureData.ts). */
export function makeTextures(p: TerrainPixels): AtlasTextures {
  return {
    height: heightTexture(p.height),
    normal: rgbaTexture(p.normal),
    surface: rgbaTexture(p.surface!),
    outer: p.outer ? { height: heightTexture(p.outer.height), normal: rgbaTexture(p.outer.normal) } : undefined,
  };
}
