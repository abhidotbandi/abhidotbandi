// Hip roofs over footprints of any shape, for UT's red tile roofs: the footprint is rasterised on
// its own axes, the filled cells merged into rectangles (row runs first, then down while the run
// stays filled), and each rectangle gets a hip roof. Where wings meet, their roofs cross, as real
// ones do. Works without three.js, so the tile worker could use it too.

/** A rectangle in a footprint's axis frame (km): centre (p, q) and half extents along/across. */
export interface RoofRect {
  p: number;
  q: number;
  a: number;
  b: number;
}

/**
 * Rectangles covering a footprint (outer ring first, then holes; flat x, z km), in the frame of
 * axis (ux, uz) from origin (ox, oz). Cells are `cell` km; rectangles thinner than `minSide` km
 * are left out, their part of the roof staying flat.
 */
export function coverRectangles(
  flat: ArrayLike<number>,
  ringStarts: number[],
  ox: number,
  oz: number,
  ux: number,
  uz: number,
  cell = 0.003,
  minSide = 0.007,
): RoofRect[] {
  const n = flat.length / 2;
  const P = new Float64Array(n);
  const Q = new Float64Array(n);
  let p0 = Infinity;
  let p1 = -Infinity;
  let q0 = Infinity;
  let q1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const dx = flat[i * 2] - ox;
    const dz = flat[i * 2 + 1] - oz;
    P[i] = dx * ux + dz * uz;
    Q[i] = -dx * uz + dz * ux;
    p0 = Math.min(p0, P[i]);
    p1 = Math.max(p1, P[i]);
    q0 = Math.min(q0, Q[i]);
    q1 = Math.max(q1, Q[i]);
  }
  // Keep the grid bounded on big footprints.
  while (((p1 - p0) / cell) * ((q1 - q0) / cell) > 40000) cell *= 1.5;
  const nP = Math.max(1, Math.ceil((p1 - p0) / cell));
  const nQ = Math.max(1, Math.ceil((q1 - q0) / cell));
  const filled = new Uint8Array(nP * nQ);
  const starts = [...ringStarts, n];
  const xs: number[] = [];
  for (let j = 0; j < nQ; j++) {
    // Scanline through the row's centre: fill between pairs of crossings (even-odd, so holes
    // stay empty).
    const qc = q0 + (j + 0.5) * cell;
    xs.length = 0;
    for (let r = 0; r + 1 < starts.length; r++) {
      const s0 = starts[r];
      const s1 = starts[r + 1];
      for (let i = s0; i < s1; i++) {
        const k = i + 1 < s1 ? i + 1 : s0;
        if (Q[i] > qc !== Q[k] > qc) xs.push(P[i] + ((qc - Q[i]) * (P[k] - P[i])) / (Q[k] - Q[i]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let m = 0; m + 1 < xs.length; m += 2) {
      const i0 = Math.max(0, Math.ceil((xs[m] - p0) / cell - 0.5));
      const i1 = Math.min(nP - 1, Math.floor((xs[m + 1] - p0) / cell - 0.5));
      for (let i = i0; i <= i1; i++) filled[j * nP + i] = 1;
    }
  }
  const out: RoofRect[] = [];
  const minCells = Math.max(1, Math.round(minSide / cell));
  for (let j = 0; j < nQ; j++) {
    for (let i = 0; i < nP; i++) {
      if (filled[j * nP + i] !== 1) continue;
      let i1 = i;
      while (i1 + 1 < nP && filled[j * nP + i1 + 1] === 1) i1++;
      let j1 = j;
      for (;;) {
        if (j1 + 1 >= nQ) break;
        let ok = true;
        for (let t = i; t <= i1 && ok; t++) ok = filled[(j1 + 1) * nP + t] === 1;
        if (!ok) break;
        j1++;
      }
      for (let jj = j; jj <= j1; jj++) for (let t = i; t <= i1; t++) filled[jj * nP + t] = 2;
      if (i1 - i + 1 < minCells || j1 - j + 1 < minCells) continue;
      // Out to the true edge, which lies within half a cell of the outermost cells.
      out.push({
        p: p0 + ((i + i1 + 1) / 2) * cell,
        q: q0 + ((j + j1 + 1) / 2) * cell,
        a: ((i1 - i + 1) / 2) * cell + cell / 2,
        b: ((j1 - j + 1) / 2) * cell + cell / 2,
      });
    }
  }
  return out;
}

/**
 * A hip roof's six points over a rectangle (world x, z km): four eaves at y0 and two ridge ends
 * at y0 + h, ridge along the longer side. Faces: [e0, e1, r1, r0], [e2, e3, r0, r1] (the long
 * sides) and [e3, e0, r0], [e1, e2, r1] (the hips).
 */
export function hipRoof(
  rect: RoofRect,
  ox: number,
  oz: number,
  ux: number,
  uz: number,
  eave: number,
  pitch: number,
  maxRise: number,
): { eaves: [number, number][]; ridge: [number, number][]; rise: number } {
  let ax = ux;
  let az = uz;
  let A = rect.a + eave;
  let B = rect.b + eave;
  if (B > A) {
    [A, B] = [B, A];
    ax = -uz;
    az = ux;
  }
  const cx = ox + ux * rect.p - uz * rect.q;
  const cz = oz + uz * rect.p + ux * rect.q;
  const at = (p: number, q: number): [number, number] => [cx + ax * p - az * q, cz + az * p + ax * q];
  const ridge = Math.max(0, A - B);
  return {
    eaves: [at(-A, -B), at(A, -B), at(A, B), at(-A, B)],
    ridge: [at(-ridge, 0), at(ridge, 0)],
    rise: Math.min(maxRise, B * pitch),
  };
}
