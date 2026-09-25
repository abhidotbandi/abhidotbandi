import earcut from "earcut";
import * as THREE from "three";
import type { BuildingsRaw } from "./assets";
import { BUILDING_EXAG, elevToY, type RegionRaster } from "./geo";

export interface BuildingMesh {
  geometry: THREE.BufferGeometry;
  /** per SITES index: highest roof (world y, km) of the site's own buildings, or NaN */
  siteTop: Float32Array;
}

/**
 * Extrude footprints into one merged geometry. Walls and roofs share vertices; the
 * shader derives flat normals from screen-space derivatives, so no normals are stored.
 * aInfo = (site index or -1, base y, height in metres).
 */
export function buildBuildings(
  raw: BuildingsRaw,
  height: RegionRaster,
  siteIndexOf: (id: string) => number,
  siteCount: number,
  minFootprintM2 = 0,
): BuildingMesh {
  const siteMap = raw.sites.map(siteIndexOf);
  const siteTop = new Float32Array(siteCount).fill(Number.NaN);

  // First pass: sizes.
  let nVerts = 0;
  let nIdx = 0;
  for (const rec of raw.b) {
    let i = 2;
    let rings = 0;
    let pts = 0;
    while (i < rec.length) {
      const n = rec[i];
      pts += n;
      rings++;
      i += 1 + n * 2;
    }
    nVerts += pts * 2;
    nIdx += pts * 6 + (pts - 2 + 2 * (rings - 1)) * 3;
  }

  const pos = new Float32Array(nVerts * 3);
  const info = new Float32Array(nVerts * 3);
  const idx = new Uint32Array(nIdx);
  let v = 0;
  let k = 0;
  const flat: number[] = [];
  const holes: number[] = [];

  for (const rec of raw.b) {
    const hM = rec[0] / 10;
    const site = rec[1] >= 0 ? siteMap[rec[1]] : -1;

    // Decode rings (metres, delta-encoded) to km.
    flat.length = 0;
    holes.length = 0;
    let i = 2;
    let minElev = Infinity;
    let first = true;
    while (i < rec.length) {
      const n = rec[i];
      if (!first) holes.push(flat.length / 2);
      let x = 0;
      let z = 0;
      for (let j = 0; j < n; j++) {
        x += rec[i + 1 + j * 2];
        z += rec[i + 2 + j * 2];
        flat.push(x / 1000, z / 1000);
        if (first) minElev = Math.min(minElev, height.sample(x / 1000, z / 1000));
      }
      first = false;
      i += 1 + n * 2;
    }
    const outerN = holes.length ? holes[0] : flat.length / 2;
    if (minFootprintM2 > 0 && site < 0) {
      let a = 0;
      for (let j = 0; j < outerN; j++) {
        const j2 = (j + 1) % outerN;
        a += flat[j * 2] * flat[j2 * 2 + 1] - flat[j2 * 2] * flat[j * 2 + 1];
      }
      if (Math.abs(a / 2) * 1e6 < minFootprintM2) continue;
    }

    const yBase = elevToY(minElev) - 0.003;
    const yTop = elevToY(minElev) + (hM / 1000) * BUILDING_EXAG;
    if (site >= 0 && !(siteTop[site] >= yTop)) siteTop[site] = yTop;

    const nPts = flat.length / 2;
    const bottom = v;
    const top = v + nPts;
    for (let j = 0; j < nPts; j++) {
      const x = flat[j * 2];
      const z = flat[j * 2 + 1];
      pos[(bottom + j) * 3] = x;
      pos[(bottom + j) * 3 + 1] = yBase;
      pos[(bottom + j) * 3 + 2] = z;
      pos[(top + j) * 3] = x;
      pos[(top + j) * 3 + 1] = yTop;
      pos[(top + j) * 3 + 2] = z;
      info[(bottom + j) * 3] = site;
      info[(bottom + j) * 3 + 1] = yBase;
      info[(bottom + j) * 3 + 2] = hM;
      info[(top + j) * 3] = site;
      info[(top + j) * 3 + 1] = yBase;
      info[(top + j) * 3 + 2] = hM;
    }
    // Walls, ring by ring.
    const starts = [0, ...holes, nPts];
    for (let r = 0; r < starts.length - 1; r++) {
      const s0 = starts[r];
      const s1 = starts[r + 1];
      for (let j = s0; j < s1; j++) {
        const j2 = j + 1 < s1 ? j + 1 : s0;
        idx[k++] = bottom + j;
        idx[k++] = bottom + j2;
        idx[k++] = top + j2;
        idx[k++] = bottom + j;
        idx[k++] = top + j2;
        idx[k++] = top + j;
      }
    }
    // Roof.
    const tri = earcut(flat, holes.length ? holes : undefined, 2);
    for (let t = 0; t < tri.length; t++) idx[k++] = top + tri[t];
    v += nPts * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
  geometry.setAttribute("aInfo", new THREE.BufferAttribute(info.subarray(0, v * 3), 3));
  geometry.setIndex(new THREE.BufferAttribute(idx.subarray(0, k), 1));
  geometry.computeBoundingSphere();
  return { geometry, siteTop };
}
