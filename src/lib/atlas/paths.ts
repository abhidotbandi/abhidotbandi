// Polylines you can move along: sampling by distance, and the loops boats row on the river.

import type { River } from "./central";

/** A polyline (x,z pairs, km) with cumulative lengths, for moving things along it. */
export class Path {
  readonly cum: Float32Array;
  readonly length: number;

  constructor(
    readonly pts: Float32Array,
    readonly closed = false,
  ) {
    const n = pts.length / 2;
    this.cum = new Float32Array(n + (closed ? 1 : 0));
    for (let i = 1; i < n; i++) {
      this.cum[i] = this.cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    }
    if (closed) this.cum[n] = this.cum[n - 1] + Math.hypot(pts[0] - pts[n * 2 - 2], pts[1] - pts[n * 2 - 1]);
    this.length = this.cum[this.cum.length - 1];
  }

  /** Point and unit direction of travel at distance d (wrapped on closed paths, clamped otherwise). */
  at(d: number, out: { x: number; z: number; dx: number; dz: number }): void {
    const L = this.length;
    let s = this.closed ? ((d % L) + L) % L : Math.max(0, Math.min(L, d));
    const cum = this.cum;
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const n = this.pts.length / 2;
    const i0 = lo % n;
    const i1 = hi % n;
    const seg = cum[hi] - cum[lo] || 1e-9;
    s = (s - cum[lo]) / seg;
    const ax = this.pts[i0 * 2];
    const az = this.pts[i0 * 2 + 1];
    const bx = this.pts[i1 * 2];
    const bz = this.pts[i1 * 2 + 1];
    out.x = ax + (bx - ax) * s;
    out.z = az + (bz - az) * s;
    const len = Math.hypot(bx - ax, bz - az) || 1;
    out.dx = (bx - ax) / len;
    out.dz = (bz - az) / len;
  }
}

/** Index of the centreline vertex nearest a point. */
export function nearestIndex(line: Float32Array, x: number, z: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < line.length / 2; i++) {
    const d = (line[i * 2] - x) ** 2 + (line[i * 2 + 1] - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/**
 * A rowing loop on a river between two centreline vertices: down one side, a wide turn,
 * back up the other, keeping to the right as crews on Lady Bird Lake do.
 * lane: 0..1 across the water on each side; margin: km to keep from the shore.
 */
export function rowingLoop(river: River, i0: number, i1: number, lane: number, margin: number): Path {
  const { line, half } = river;
  const a = Math.min(i0, i1);
  const b = Math.max(i0, i1);
  const side = (i: number, sign: number) => {
    // Offset from the centreline: sign = 1 is the right of downstream travel.
    const j0 = Math.max(0, i - 1);
    const j1 = Math.min(line.length / 2 - 1, i + 1);
    let tx = line[j1 * 2] - line[j0 * 2];
    let tz = line[j1 * 2 + 1] - line[j0 * 2 + 1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const nx = -tz;
    const nz = tx;
    const w = Math.max(0, half[i] - margin) * (0.25 + 0.7 * lane);
    return [line[i * 2] + nx * w * sign, line[i * 2 + 1] + nz * w * sign];
  };
  const pts: number[] = [];
  // (-tz, tx) points to the right of downstream travel: go down that side, come back up the other.
  for (let i = a; i <= b; i++) pts.push(...side(i, 1));
  // Turn across at the downstream end, then upstream on the other side.
  const turn = (i: number, from: number, to: number) => {
    for (let k = 1; k < 6; k++) {
      const t = k / 6;
      const [x0, z0] = side(i, from);
      const [x1, z1] = side(i, to);
      // Bulge the turn a little past the end so it reads as a turn, not a zig-zag.
      const j = Math.max(0, Math.min(line.length / 2 - 1, i + (i === b ? 1 : -1)));
      const bx = (line[j * 2] - line[i * 2]) * Math.sin(Math.PI * t) * 1.2;
      const bz = (line[j * 2 + 1] - line[i * 2 + 1]) * Math.sin(Math.PI * t) * 1.2;
      pts.push(x0 + (x1 - x0) * t + bx, z0 + (z1 - z0) * t + bz);
    }
  };
  turn(b, 1, -1);
  for (let i = b; i >= a; i--) pts.push(...side(i, -1));
  turn(a, -1, 1);
  return new Path(new Float32Array(pts), true);
}
