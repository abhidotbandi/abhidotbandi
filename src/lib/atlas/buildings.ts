import * as THREE from "three";
import type { BuildingArrays } from "./extrude";

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
