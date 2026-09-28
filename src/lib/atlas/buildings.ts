import * as THREE from "three";
import type { BuildingsData } from "./buildingsCodec";
import { extrudeBuildings, type BuildingArrays } from "./extrude";
import type { HeightField } from "./geo";

export { KIND_PITCHED, KIND_PLAIN, KIND_ROOF_PLANT } from "./extrude";

export interface BuildingMesh {
  geometry: THREE.BufferGeometry;
  /** per SITES index: highest roof (world y, km) of the site's own buildings, or NaN */
  siteTop: Float32Array;
}

/** An indexed geometry over extruded building arrays (attributes aInfo and aU, no normals). */
export function buildingGeometry(a: Omit<BuildingArrays, "siteTop">): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(a.position, 3));
  geometry.setAttribute("aInfo", new THREE.BufferAttribute(a.info, 4));
  geometry.setAttribute("aU", new THREE.BufferAttribute(a.u, 1));
  geometry.setIndex(new THREE.BufferAttribute(a.index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Extrude footprints into one merged geometry, with roofs to match (see extrudeBuildings).
 */
export function buildBuildings(
  data: BuildingsData,
  height: HeightField,
  siteIndexOf: (id: string) => number,
  siteCount: number,
  minFootprintM2 = 0,
  /** leave out footprints this accepts, by centre (km) and SITES index: modelled separately */
  skip?: (x: number, z: number, site: number) => boolean,
): BuildingMesh {
  const a = extrudeBuildings(data, height, data.sites.map(siteIndexOf), siteCount, minFootprintM2, skip);
  return { geometry: buildingGeometry(a), siteTop: a.siteTop };
}
