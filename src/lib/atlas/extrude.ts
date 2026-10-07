// Building extrusion without three.js, so a worker can run it for the detail tiles.

import earcut from "earcut";
import type { BuildingsData } from "./buildingsCodec";
import { BUILDING_EXAG, elevToY, type HeightField } from "./geo";
import { coverRectangles, hipRoof } from "./roofs";

/** Extruded buildings as the arrays of an indexed geometry. */
export interface BuildingArrays {
  position: Float32Array;
  /** (site index or KIND_*, base y, height in metres, per-building 0..1) */
  info: Float32Array;
  /** metres along the ring from its first corner, for facade detail */
  u: Float32Array;
  index: Uint32Array;
  /** per SITES index: highest roof (world y, km) of the site's own buildings, or NaN */
  siteTop: Float32Array;
}

/** aInfo.x for vertices that aren't a company site's own building (which carry its index). */
export const KIND_PLAIN = -1;
/** Rooftop plant: HVAC boxes and tower penthouses. */
export const KIND_ROOF_PLANT = -2;
/** The pitched roof of a house. */
export const KIND_PITCHED = -3;
/** A rooftop pool. */
export const KIND_POOL = -4;

/**
 * Building styles, carried in aInfo.w's whole part (its fraction is the per-building random):
 * UT's campus under red tile hip roofs, the campus with flat roofs, West Campus's towers, the
 * Capitol's sunset-red granite, and the state's limestone and granite offices around it.
 */
export const STYLE_CAMPUS_TILE = 1;
export const STYLE_CAMPUS_FLAT = 2;
export const STYLE_WEST_CAMPUS = 3;
export const STYLE_CAPITOL = 4;
export const STYLE_STATE = 5;
/** Austin-Bergstrom's buildings (airport.ts): its garages as open parking decks, its round tanks
 * in white, and its sheds, hangars and offices flat-roofed in pale cladding. */
export const STYLE_GARAGE = 6;
export const STYLE_TANK = 7;
export const STYLE_AIRPORT = 8;

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
export function extrudeBuildings(
  data: BuildingsData,
  height: HeightField,
  /** per entry of the file's site table: its SITES index, or -1 */
  siteMap: ArrayLike<number>,
  siteCount: number,
  minFootprintM2 = 0,
  /**
   * leave out footprints this accepts, by centre (km) and SITES index (or -1): landmarks and
   * sites modelled separately. "roof": left out, but a company's building still sets its site's
   * roof height (a landmark modelled in its place, so the beacon stands on the model).
   */
  skip?: (x: number, z: number, site: number) => boolean | "roof",
  /** a STYLE_* for a footprint (outer ring flat x, z km), by its height and area; 0 for none */
  style?: (ring: number[], hM: number, areaM2: number) => number,
): BuildingArrays {
  const siteTop = new Float32Array(siteCount).fill(Number.NaN);
  const { ringStart, vertStart, x: X, z: Z } = data;
  const records: number[] = [];
  for (let b = 0; b < data.count; b++) {
    const site = data.site[b] >= 0 ? siteMap[data.site[b]] : -1;
    const left = skip ? skip(...outerCentre(data, b), site) : false;
    if (!left) records.push(b);
    else if (left === "roof" && site >= 0) {
      let minElev = Infinity;
      for (let j = vertStart[ringStart[b]]; j < vertStart[ringStart[b] + 1]; j++) {
        minElev = Math.min(minElev, height.sample(X[j] / 1000, Z[j] / 1000));
      }
      const yTop = elevToY(minElev) + (data.height[b] / 10 / 1000) * BUILDING_EXAG;
      if (!(siteTop[site] >= yTop)) siteTop[site] = yTop;
    }
  }

  // Upper bounds on sizes: walls (with parapets), doubled ring starts, roofs and up to four roof
  // boxes.
  let maxV = 0;
  let maxI = 0;
  for (const b of records) {
    const rings = ringStart[b + 1] - ringStart[b];
    const pts = vertStart[ringStart[b + 1]] - vertStart[ringStart[b]];
    maxV += pts * 3 + rings * 3 + 6 + 4 * 8;
    maxI += pts * 6 + (pts - 2 + 2 * (rings - 1)) * 3 + 18 + 4 * 30;
  }

  let pos = new Float32Array(maxV * 3);
  let info = new Float32Array(maxV * 4);
  let uArr = new Float32Array(maxV);
  let v = 0;
  let k = 0;
  let idx = new Uint32Array(maxI);
  /** Room for nv more vertices and ni more indices (the styled roofs aren't in the bounds above). */
  const ensure = (nv: number, ni: number) => {
    if (v + nv > uArr.length) {
      const cap = Math.max(uArr.length * 2, v + nv);
      const grow = <T extends Float32Array>(a: T, n: number) => {
        const b = new Float32Array(n);
        b.set(a);
        return b;
      };
      pos = grow(pos, cap * 3);
      info = grow(info, cap * 4);
      uArr = grow(uArr, cap);
    }
    if (k + ni > idx.length) {
      const b = new Uint32Array(Math.max(idx.length * 2, k + ni));
      b.set(idx);
      idx = b;
    }
  };
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
    const flags = style ? style(flat.slice(0, outerN * 2), hM, areaM2) : 0;
    const rand = hash(flat[0], flat[1]);
    // The style rides in the whole part of the per-building random.
    const r = rand + flags;

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
    const house = site < 0 && !flags && rings === 1 && hM <= 10 && areaM2 >= 40 && areaM2 <= 450;
    // Flat roofs sit behind a parapet: the walls rise a little above them (the material draws
    // both faces, so the parapet's inside shows from above).
    const parapet = !house && flags !== STYLE_CAMPUS_TILE && flags !== STYLE_TANK && hM >= 6 ? ((hM >= 45 ? 1.5 : 1.0) / 1000) * BUILDING_EXAG : 0;
    const bottom = v;
    for (let j = 0; j < nPts; j++) vert(flat[j * 2], yBase, flat[j * 2 + 1], kind, yBase, hM, r, ringU[j]);
    const top = v;
    for (let j = 0; j < nPts; j++) vert(flat[j * 2], yTop, flat[j * 2 + 1], kind, yBase, hM, r, ringU[j]);
    let wallTop = top;
    if (parapet > 0) {
      wallTop = v;
      for (let j = 0; j < nPts; j++) vert(flat[j * 2], yTop + parapet, flat[j * 2 + 1], kind, yBase, hM, r, ringU[j]);
    }
    const wrapB = v;
    for (let ri = 0; ri < rings; ri++) vert(flat[starts[ri] * 2], yBase, flat[starts[ri] * 2 + 1], kind, yBase, hM, r, perim[ri]);
    const wrapT = v;
    for (let ri = 0; ri < rings; ri++) vert(flat[starts[ri] * 2], yTop + parapet, flat[starts[ri] * 2 + 1], kind, yBase, hM, r, perim[ri]);

    // Walls, ring by ring.
    for (let ri = 0; ri < rings; ri++) {
      const s0 = starts[ri];
      const s1 = starts[ri + 1];
      for (let j = s0; j < s1; j++) {
        const last = j + 1 >= s1;
        const b2 = last ? wrapB + ri : bottom + j + 1;
        const t2 = last ? wrapT + ri : wallTop + j + 1;
        tri(bottom + j, b2, t2);
        tri(bottom + j, t2, wallTop + j);
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
    if (house) {
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
      const hip = rand < 0.6;
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

    if (flags === STYLE_CAMPUS_TILE) {
      // Red tile hip roofs over the footprint's wings, eaves a little proud of the walls.
      const rects = coverRectangles(flat, [0, ...holes], flat[0], flat[1], ux, uz);
      ensure(rects.length * 6, rects.length * 18);
      for (const rect of rects) {
        const h = hipRoof(rect, flat[0], flat[1], ux, uz, 0.0006, 0.42, 0.009);
        const ridgeY = yTop + h.rise * BUILDING_EXAG;
        const e = h.eaves.map(([x, z]) => vert(x, yTop, z, KIND_PITCHED, yBase, hM, r, 0));
        const [r0, r1] = h.ridge.map(([x, z]) => vert(x, ridgeY, z, KIND_PITCHED, yBase, hM, r, 0));
        tri(e[0], e[1], r1);
        tri(e[0], r1, r0);
        tri(e[2], e[3], r0);
        tri(e[2], r0, r1);
        tri(e[3], e[0], r0);
        tri(e[1], e[2], r1);
      }
      continue;
    }

    // West Campus towers: a pool deck on the roof, the plant at its end.
    if (flags === STYLE_WEST_CAMPUS && hM >= 40 && areaM2 >= 700) {
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
      ensure(4, 6);
      const pc = ea * 0.25;
      const pa = ea * 0.3;
      const pb = eb * 0.32;
      const py = yTop + 0.0004;
      const P = (p: number, q: number) => vert(sx + ux * p - uz * q, py, sz + uz * p + ux * q, KIND_POOL, yBase, hM, r, 0);
      const q0 = P(pc - pa, -pb);
      const q1 = P(pc + pa, -pb);
      const q2 = P(pc + pa, pb);
      const q3 = P(pc - pa, pb);
      tri(q0, q1, q2);
      tri(q0, q2, q3);
      roofBox(sx - ux * ea * 0.5, sz - uz * ea * 0.5, ux, uz, ea * 0.3, eb * 0.4, yTop, 4 + rand * 2, rand);
      continue;
    }

    // Rooftop plant on larger buildings; a penthouse on towers. The campus's flat roofs, the
    // state's offices around the Capitol, parking decks and tanks are kept clean.
    const clean = flags === STYLE_CAMPUS_FLAT || flags === STYLE_STATE || flags === STYLE_GARAGE || flags === STYLE_TANK;
    if (hM > 10 && areaM2 >= 250 && !clean) {
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
        const ph = 5 + rand * 3;
        roofBox(sx, sz, ux, uz, ea * 0.42, eb * 0.42, yTop, ph, rand);
        // A smaller plant room on the penthouse, and on rectangular towers plant units either side.
        if (rand > 0.35) {
          const y1 = yTop + (ph / 1000) * BUILDING_EXAG;
          roofBox(sx + ux * ea * 0.1, sz + uz * ea * 0.1, ux, uz, ea * 0.2, eb * 0.24, y1, 3 + rand * 2, rand);
        }
        if (areaM2 >= 4 * ea * eb * 1e6 * 0.82) {
          for (const side of [-1, 1]) {
            const rr = hash(sx + side * 0.01, sz);
            if (rr < 0.3) continue;
            roofBox(sx + ux * ea * 0.62 * side, sz + uz * ea * 0.62 * side, ux, uz, ea * 0.08, eb * (0.14 + rr * 0.1), yTop, 2 + rr * 1.5, rand);
          }
        }
      } else {
        // Boxes at the largest roof triangles.
        const n = 1 + Math.floor(rand * 3);
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
          roofBox(cx, cz, ux, uz, half * (0.8 + rr * 0.5), half * (0.6 + rr * 0.4), yTop, 2.2 + rr * 2, rand);
        }
      }
    }
  }

  return {
    position: pos.slice(0, v * 3),
    info: info.slice(0, v * 4),
    u: uArr.slice(0, v),
    index: idx.slice(0, k),
    siteTop,
  };
}
