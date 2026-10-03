import * as THREE from "three";

// Low-poly figures shared by the river and the parks, modelled in metres.

export function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Merge geometries into one non-indexed geometry with positions and normals. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    pos.push(...(g.attributes.position.array as Float32Array));
    nrm.push(...(g.attributes.normal.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}

/** Torso (seated): origin at the seat. */
export const bodyGeo = () => merge([box(0.42, 0.55, 0.26, 0, 0.3, 0)]);
/** Standing: legs and torso, origin at the feet. */
export const standGeo = () => merge([box(0.3, 0.82, 0.2, 0, 0.41, 0), box(0.44, 0.6, 0.26, 0, 1.12, 0)]);
/** Lying on a towel: a flat body along +z, origin at the hips. */
export const lyingGeo = () => merge([box(0.42, 0.2, 1.5, 0, 0.1, 0)]);
export const headGeo = () => new THREE.IcosahedronGeometry(0.12, 0);

export const SKIN = ["#f1c6a6", "#d9a47f", "#b87b56", "#8d5a3b", "#5c3a26"].map((c) => new THREE.Color(c));
export const SHIRTS = ["#1d2b4f", "#bf5700", "#f4f1ea", "#20242b", "#c8352e", "#2f6fb0", "#e8c34a", "#3a8f5c"];

export function pick<T>(list: T[], r: number): T {
  return list[Math.floor(r * list.length) % list.length];
}

/** Instanced mesh with per-instance colour, drawn dynamically. */
export function instanced(g: THREE.BufferGeometry, m: THREE.Material, n: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(g, m, n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

/**
 * Send the first `n` instances of a pool to the GPU, rather than the whole pool (mostly unused,
 * and megabytes for the trees): three uploads only the ranges marked. (A range of none would
 * upload everything, so an empty pool sends nothing.)
 */
export function uploadInstances(m: THREE.InstancedMesh, n = m.count, colors = true) {
  if (n <= 0) return;
  m.instanceMatrix.addUpdateRange(0, n * 16);
  m.instanceMatrix.needsUpdate = true;
  if (colors && m.instanceColor) {
    m.instanceColor.addUpdateRange(0, n * 3);
    m.instanceColor.needsUpdate = true;
  }
}

/** Exaggeration for people: near true size up close, growing with distance so a crowd still reads. */
export function figureScale(dist: number): number {
  return Math.min(9, Math.max(1.5, dist / 0.13));
}

/** 0 outside a time-of-day window, 1 inside, with soft edges. */
export function inWindow(tod: number, w: [number, number]): number {
  const e = 0.015;
  return THREE.MathUtils.smoothstep(tod, w[0] - e, w[0] + e) * (1 - THREE.MathUtils.smoothstep(tod, w[1] - e, w[1] + e));
}
