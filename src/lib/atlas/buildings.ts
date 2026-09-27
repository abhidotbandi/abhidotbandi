import earcut from "earcut";
import * as THREE from "three";
import type { BuildingsData } from "./buildingsCodec";
import { BUILDING_EXAG, elevToY, type HeightField } from "./geo";

export interface BuildingMesh {
  geometry: THREE.BufferGeometry;
  /** per SITES index: highest roof (world y, km) of the site's own buildings, or NaN */
  siteTop: Float32Array;
}

/** aInfo.x for vertices that aren't a company site's own building (which carry its index). */
export const KIND_PLAIN = -1;
/** Rooftop plant: HVAC boxes and tower penthouses. */
export const KIND_ROOF_PLANT = -2;
/** The pitched roof of a house. */
export const KIND_PITCHED = -3;

/** Mean vertex of a building's outer ring, km. */
function outerCentre(d: BuildingsData, b: number): [number, number] {
  const v0 = d.vertStart[d.ringStart[b]];
  const v1 = d.vertStart[d.ringStart[b] + 1];
  let sx = 0;
  let sz = 0;
  for (let j = v0; j < v1; j++) {
    sx += d.x[j];
    sz += d.z[j];
  }
  return [sx / (v1 - v0) / 1000, sz / (v1 - v0) / 1000];
}

/** Stable 0..1 value per building, from where it stands. */
function hash(x: number, z: number): number {
  const s = Math.sin(x * 12989.8 + z * 78233.1) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Extrude footprints into one merged geometry, with roofs to match: pitched roofs on houses,
 * rooftop plant on larger buildings and penthouses on towers. Walls and roofs share vertices
 * (each ring's first corner is doubled so the facade coordinate can wrap); the shader derives
 * flat normals from screen-space derivatives, so no normals are stored.
 * aInfo = (site index or KIND_*, base y, height in metres, per-building 0..1).
 * aU = metres along the ring from its first corner, for facade detail.
 */
export function buildBuildings(
  data: BuildingsData,
  height: HeightField,
  siteIndexOf: (id: string) => number,
  siteCount: number,
  minFootprintM2 = 0,
  /** leave out footprints whose centre (km) this accepts: landmarks modelled separately */
  skip?: (x: number, z: number) => boolean,
): BuildingMesh {
  const siteMap = data.sites.map(siteIndexOf);
  const siteTop = new Float32Array(siteCount).fill(Number.NaN);
  const { ringStart, vertStart, x: X, z: Z } = data;
  const records: number[] = [];
  for (let b = 0; b < data.count; b++) if (!skip || !skip(...outerCentre(data, b))) records.push(b);

  // Upper bounds on sizes: walls, doubled ring starts, roofs and up to four roof boxes.
  let maxV = 0;
  let maxI = 0;
  for (const b of records) {
    const rings = ringStart[b + 1] - ringStart[b];
    const pts = vertStart[ringStart[b + 1]] - vertStart[ringStart[b]];
    maxV += pts * 2 + rings * 2 + 6 + 4 * 8;
    maxI += pts * 6 + (pts - 2 + 2 * (rings - 1)) * 3 + 18 + 4 * 30;
  }

  const pos = new Float32Array(maxV * 3);
  const info = new Float32Array(maxV * 4);
  const uArr = new Float32Array(maxV);
  let v = 0;
  let k = 0;
  const idx = new Uint32Array(maxI);
  const flat: number[] = [];
  const holes: number[] = [];
  const ringU: number[] = [];

  const vert = (x: number, y: number, z: number, kind: number, yBase: number, hM: number, r: number, u: number) => {
    pos[v * 3] = x;
    pos[v * 3 + 1] = y;
    pos[v * 3 + 2] = z;
    info[v * 4] = kind;
    info[v * 4 + 1] = yBase;
    info[v * 4 + 2] = hM;
    info[v * 4 + 3] = r;
    uArr[v] = u;
    return v++;
  };
  const tri = (a: number, b: number, c: number) => {
    idx[k++] = a;
    idx[k++] = b;
    idx[k++] = c;
  };

  /** A box standing on a roof at y0: centre (cx, cz), half extents a along (ux, uz) and b across, km. */
  const roofBox = (cx: number, cz: number, ux: number, uz: number, a: number, b: number, y0: number, hM: number, r: number) => {
    const y1 = y0 + (hM / 1000) * BUILDING_EXAG;
    const base = v;
    for (const y of [y0, y1]) {
      for (const [p, q] of [
        [-a, -b],
        [a, -b],
        [a, b],
        [-a, b],
      ]) {
        vert(cx + ux * p - uz * q, y, cz + uz * p + ux * q, KIND_ROOF_PLANT, y0, hM, r, 0);
      }
    }
    for (let j = 0; j < 4; j++) {
      const j2 = (j + 1) % 4;
      tri(base + j, base + j2, base + 4 + j2);
      tri(base + j, base + 4 + j2, base + 4 + j);
    }
    tri(base + 4, base + 5, base + 6);
    tri(base + 4, base + 6, base + 7);
  };

  for (const b of records) {
    const hM = data.height[b] / 10;
    const site = data.site[b] >= 0 ? siteMap[data.site[b]] : -1;

    // Rings (outer, then holes) from metres to km; the building stands on its lowest corner.
    flat.length = 0;
    holes.length = 0;
    let minElev = Infinity;
    for (let ri = ringStart[b]; ri < ringStart[b + 1]; ri++) {
      if (ri > ringStart[b]) holes.push(flat.length / 2);
      for (let j = vertStart[ri]; j < vertStart[ri + 1]; j++) {
        const x = X[j] / 1000;
        const z = Z[j] / 1000;
        flat.push(x, z);
        if (ri === ringStart[b]) minElev = Math.min(minElev, height.sample(x, z));
      }
    }
    const nPts = flat.length / 2;
    const outerN = holes.length ? holes[0] : nPts;
    let area2 = 0;
    for (let j = 0; j < outerN; j++) {
      const j2 = (j + 1) % outerN;
      area2 += flat[j * 2] * flat[j2 * 2 + 1] - flat[j2 * 2] * flat[j * 2 + 1];
    }
    const areaM2 = (Math.abs(area2) / 2) * 1e6;
    if (minFootprintM2 > 0 && site < 0 && areaM2 < minFootprintM2) continue;

    const yBase = elevToY(minElev) - 0.003;
    const yTop = elevToY(minElev) + (hM / 1000) * BUILDING_EXAG;
    if (site >= 0 && !(siteTop[site] >= yTop)) siteTop[site] = yTop;
    const kind = site >= 0 ? site : KIND_PLAIN;
    const r = hash(flat[0], flat[1]);

    // Facade coordinate: metres along each ring, wrapping at a doubled first corner.
    const starts = [0, ...holes, nPts];
    const rings = starts.length - 1;
    ringU.length = 0;
    const perim: number[] = [];
    for (let ri = 0; ri < rings; ri++) {
      const s0 = starts[ri];
      const s1 = starts[ri + 1];
      let cum = 0;
      for (let j = s0; j < s1; j++) {
        if (j > s0) cum += Math.hypot(flat[j * 2] - flat[j * 2 - 2], flat[j * 2 + 1] - flat[j * 2 - 1]) * 1000;
        ringU.push(cum);
      }
      perim.push(cum + Math.hypot(flat[s0 * 2] - flat[(s1 - 1) * 2], flat[s0 * 2 + 1] - flat[(s1 - 1) * 2 + 1]) * 1000);
    }
    const bottom = v;
    for (let j = 0; j < nPts; j++) vert(flat[j * 2], yBase, flat[j * 2 + 1], kind, yBase, hM, r, ringU[j]);
    const top = v;
    for (let j = 0; j < nPts; j++) vert(flat[j * 2], yTop, flat[j * 2 + 1], kind, yBase, hM, r, ringU[j]);
    const wrapB = v;
    for (let ri = 0; ri < rings; ri++) vert(flat[starts[ri] * 2], yBase, flat[starts[ri] * 2 + 1], kind, yBase, hM, r, perim[ri]);
    const wrapT = v;
    for (let ri = 0; ri < rings; ri++) vert(flat[starts[ri] * 2], yTop, flat[starts[ri] * 2 + 1], kind, yBase, hM, r, perim[ri]);

    // Walls, ring by ring.
    for (let ri = 0; ri < rings; ri++) {
      const s0 = starts[ri];
      const s1 = starts[ri + 1];
      for (let j = s0; j < s1; j++) {
        const last = j + 1 >= s1;
        const b2 = last ? wrapB + ri : bottom + j + 1;
        const t2 = last ? wrapT + ri : top + j + 1;
        tri(bottom + j, b2, t2);
        tri(bottom + j, t2, top + j);
      }
    }

    // The footprint's main axis: its longest outer edge.
    let best = 0;
    let ux = 1;
    let uz = 0;
    for (let j = 0; j < outerN; j++) {
      const j2 = (j + 1) % outerN;
      const dx = flat[j2 * 2] - flat[j * 2];
      const dz = flat[j2 * 2 + 1] - flat[j * 2 + 1];
      const l = Math.hypot(dx, dz);
      if (l > best) {
        best = l;
        ux = dx / l;
        uz = dz / l;
      }
    }

    // Houses get a pitched roof over the footprint's bounding rectangle, with eaves.
    if (site < 0 && rings === 1 && hM <= 10 && areaM2 >= 40 && areaM2 <= 450) {
      let a0 = Infinity;
      let a1 = -Infinity;
      let b0 = Infinity;
      let b1 = -Infinity;
      for (let j = 0; j < nPts; j++) {
        const dx = flat[j * 2] - flat[0];
        const dz = flat[j * 2 + 1] - flat[1];
        const p = dx * ux + dz * uz;
        const q = -dx * uz + dz * ux;
        a0 = Math.min(a0, p);
        a1 = Math.max(a1, p);
        b0 = Math.min(b0, q);
        b1 = Math.max(b1, q);
      }
      const cp = (a0 + a1) / 2;
      const cq = (b0 + b1) / 2;
      const cx = flat[0] + ux * cp - uz * cq;
      const cz = flat[1] + uz * cp + ux * cq;
      // Ridge along the longer side.
      let ax = ux;
      let az = uz;
      let A = (a1 - a0) / 2;
      let B = (b1 - b0) / 2;
      if (B > A) {
        [A, B] = [B, A];
        ax = -uz;
        az = ux;
      }
      const eave = 0.0004;
      A += eave;
      B += eave;
      const H = Math.min(0.0045, B * 0.62) * BUILDING_EXAG;
      const hip = r < 0.6;
      const ridge = hip ? Math.max(0, A - B) : A;
      const P = (p: number, q: number, y: number) =>
        vert(cx + ax * p - az * q, y, cz + az * p + ax * q, KIND_PITCHED, yBase, hM, r, 0);
      const e1 = P(-A, -B, yTop);
      const e2 = P(A, -B, yTop);
      const e3 = P(A, B, yTop);
      const e4 = P(-A, B, yTop);
      const r1 = P(-ridge, 0, yTop + H);
      const r2 = P(ridge, 0, yTop + H);
      tri(e1, e2, r2);
      tri(e1, r2, r1);
      tri(e3, e4, r1);
      tri(e3, r1, r2);
      tri(e4, e1, r1);
      tri(e2, e3, r2);
      continue;
    }

    // Flat roof.
    const roofTri = earcut(flat, holes.length ? holes : undefined, 2);
    for (let t = 0; t < roofTri.length; t++) idx[k++] = top + roofTri[t];

    // Rooftop plant on larger buildings; a penthouse on towers.
    if (hM > 10 && areaM2 >= 250) {
      if (hM >= 45) {
        let sx = 0;
        let sz = 0;
        for (let j = 0; j < outerN; j++) {
          sx += flat[j * 2];
          sz += flat[j * 2 + 1];
        }
        sx /= outerN;
        sz /= outerN;
        let ea = 0;
        let eb = 0;
        for (let j = 0; j < outerN; j++) {
          const dx = flat[j * 2] - sx;
          const dz = flat[j * 2 + 1] - sz;
          ea = Math.max(ea, Math.abs(dx * ux + dz * uz));
          eb = Math.max(eb, Math.abs(-dx * uz + dz * ux));
        }
        roofBox(sx, sz, ux, uz, ea * 0.42, eb * 0.42, yTop, 5 + r * 3, r);
      } else {
        // Boxes at the largest roof triangles.
        const n = 1 + Math.floor(r * 3);
        const order: number[] = [];
        const areas: number[] = [];
        for (let t = 0; t < roofTri.length; t += 3) {
          const p = roofTri[t];
          const q = roofTri[t + 1];
          const s = roofTri[t + 2];
          areas.push(
            Math.abs(
              (flat[q * 2] - flat[p * 2]) * (flat[s * 2 + 1] - flat[p * 2 + 1]) -
                (flat[s * 2] - flat[p * 2]) * (flat[q * 2 + 1] - flat[p * 2 + 1]),
            ) / 2,
          );
          order.push(t);
        }
        order.sort((x, y) => areas[y / 3] - areas[x / 3]);
        for (let b = 0; b < Math.min(n, order.length); b++) {
          const t = order[b];
          const p = roofTri[t];
          const q = roofTri[t + 1];
          const s = roofTri[t + 2];
          const half = Math.min(0.005, Math.max(0.0012, Math.sqrt(areas[t / 3]) * 0.16));
          const cx = (flat[p * 2] + flat[q * 2] + flat[s * 2]) / 3;
          const cz = (flat[p * 2 + 1] + flat[q * 2 + 1] + flat[s * 2 + 1]) / 3;
          const rr = hash(cx, cz);
          roofBox(cx, cz, ux, uz, half * (0.8 + rr * 0.5), half * (0.6 + rr * 0.4), yTop, 2.2 + rr * 2, r);
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
  geometry.setAttribute("aInfo", new THREE.BufferAttribute(info.subarray(0, v * 4), 4));
  geometry.setAttribute("aU", new THREE.BufferAttribute(uArr.subarray(0, v), 1));
  geometry.setIndex(new THREE.BufferAttribute(idx.subarray(0, k), 1));
  geometry.computeBoundingSphere();
  return { geometry, siteTop };
}
