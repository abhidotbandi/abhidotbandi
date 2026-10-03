import * as THREE from "three";
import type { Central } from "@/lib/atlas/central";
import type { LaneArrays } from "@/lib/atlas/detail/build";
import { groundY, type HeightField } from "@/lib/atlas/geo";
import { CARS } from "@/lib/atlas/tiles";
import { box, instanced, merge, uploadInstances } from "./figures";
import { DECK_WIDTH, deckProfile } from "./Structures";

// Traffic around the camera: cars on the streets and arterials of the detail tiles (and, inside
// central Austin, on its roads and across its bridges), driving on the right, with headlights
// and taillights after dark. Owned by the detail tiles, which hand over each tile's lanes.

const M = 0.001;
const STEP = 0.025; // km between height samples along a road

interface Path {
  cls: number;
  /** x, z per point (km) */
  xz: Float32Array;
  /** road surface (world y) per point */
  y: Float32Array;
  /** km along, per point */
  cum: Float32Array;
  len: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

interface Car {
  path: Path | null;
  /** km along the path */
  d: number;
  dir: number;
  /** km to the right of the direction of travel */
  lane: number;
  /** km/s */
  speed: number;
  /** 0..1 as it appears */
  fade: number;
}

/** Bridge decks by position, so cars cross the river on them rather than the water. */
export interface DeckFinder {
  /** deck height (world y) if (x, z) lies on a road bridge heading along (tx, tz), else null */
  at(x: number, z: number, tx: number, tz: number): number | null;
}

export function makeDeckFinder(c: Central, ground: HeightField): DeckFinder {
  const decks = c.bridges
    .filter((b) => b.line.length >= 4 && b.cls in DECK_WIDTH && DECK_WIDTH[b.cls] >= 11)
    .map((b) => {
      const n = b.line.length / 2;
      const cum = [0];
      for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(b.line[i * 2] - b.line[i * 2 - 2], b.line[i * 2 + 1] - b.line[i * 2 - 1]));
      const half = (DECK_WIDTH[b.cls] / 2) * M + 0.004;
      let x0 = Infinity;
      let z0 = Infinity;
      let x1 = -Infinity;
      let z1 = -Infinity;
      for (let i = 0; i < n; i++) {
        x0 = Math.min(x0, b.line[i * 2] - half);
        z0 = Math.min(z0, b.line[i * 2 + 1] - half);
        x1 = Math.max(x1, b.line[i * 2] + half);
        z1 = Math.max(z1, b.line[i * 2 + 1] + half);
      }
      return { line: b.line, cum, total: cum[n - 1], half, x0, z0, x1, z1, y: deckProfile(b.line, ground) };
    });
  return {
    at(x, z, tx, tz) {
      for (const d of decks) {
        if (x < d.x0 || x > d.x1 || z < d.z0 || z > d.z1) continue;
        const l = d.line;
        for (let i = 0; i + 3 < l.length; i += 2) {
          const ax = l[i];
          const az = l[i + 1];
          const dx = l[i + 2] - ax;
          const dz = l[i + 3] - az;
          const ll = dx * dx + dz * dz || 1e-9;
          const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / ll));
          if (Math.hypot(ax + dx * t - x, az + dz * t - z) > d.half) continue;
          // Only roads running along the bridge; ones passing beneath keep their own level.
          const sl = Math.sqrt(ll);
          if (Math.abs((tx * dx + tz * dz) / (sl * (Math.hypot(tx, tz) || 1))) < 0.8) continue;
          return d.y((d.cum[i / 2] + t * sl) / (d.total || 1));
        }
      }
      return null;
    },
  };
}

function makePaths(l: LaneArrays, ground: HeightField, deck: DeckFinder | null): Path[] {
  const out: Path[] = [];
  for (let k = 0; k + 1 < l.start.length; k++) {
    const a = l.start[k];
    const b = l.start[k + 1];
    const xz: number[] = [];
    for (let j = a; j < b; j++) {
      const x = l.xz[j * 2];
      const z = l.xz[j * 2 + 1];
      if (j > a) {
        const px = l.xz[j * 2 - 2];
        const pz = l.xz[j * 2 - 1];
        const n = Math.ceil(Math.hypot(x - px, z - pz) / STEP);
        for (let s = 1; s < n; s++) xz.push(px + ((x - px) * s) / n, pz + ((z - pz) * s) / n);
      }
      xz.push(x, z);
    }
    const n = xz.length / 2;
    const y = new Float32Array(n);
    const cum = new Float32Array(n);
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = xz[i * 2];
      const z = xz[i * 2 + 1];
      if (i) cum[i] = cum[i - 1] + Math.hypot(x - xz[i * 2 - 2], z - xz[i * 2 - 1]);
      const j = Math.min(n - 1, i + 1);
      const h = Math.max(0, i - 1);
      y[i] = deck?.at(x, z, xz[j * 2] - xz[h * 2], xz[j * 2 + 1] - xz[h * 2 + 1]) ?? groundY(ground, x, z);
      x0 = Math.min(x0, x);
      z0 = Math.min(z0, z);
      x1 = Math.max(x1, x);
      z1 = Math.max(z1, z);
    }
    if (cum[n - 1] < 0.03) continue;
    out.push({ cls: l.cls[k], xz: new Float32Array(xz), y, cum, len: cum[n - 1], x0, z0, x1, z1 });
  }
  return out;
}

/** A car in metres, nose toward -z, wheels at y = 0: a body, and a cabin whose glass is darker. */
function carGeometry(): THREE.BufferGeometry {
  const g = merge([box(1.85, 1.0, 4.5, 0, 0.75, 0), box(1.6, 0.72, 2.3, 0, 1.6, 0.35)]);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  // The first box's 36 vertices are the body; the rest the cabin.
  for (let i = 0; i < n; i++) col.fill(i < 36 ? 1 : 0.42, i * 3, i * 3 + 3);
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.scale(M, M, M);
  return g;
}

const PAINT: [string, number][] = [
  ["#f2f2ef", 0.22],
  ["#1f2124", 0.18],
  ["#b9bdc2", 0.2],
  ["#6b7077", 0.14],
  ["#2f5d9e", 0.08],
  ["#b3262b", 0.1],
  ["#4a6b4f", 0.03],
  ["#d8c9a8", 0.05],
];
const PAINT_COLORS = PAINT.map(([c]) => new THREE.Color(c));
function paint(r: number): THREE.Color {
  for (let i = 0; i < PAINT.length; i++) {
    r -= PAINT[i][1];
    if (r < 0) return PAINT_COLORS[i];
  }
  return PAINT_COLORS[0];
}

const HEAD = new THREE.Color("#fff1d0");
const TAIL = new THREE.Color("#ff2a1a");
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class CarSim {
  readonly root = new THREE.Group();
  private readonly body: THREE.InstancedMesh;
  private readonly lights: THREE.Points;
  private readonly byTile = new Map<number, Path[]>();
  private readonly cars: Car[];
  private near: Path[] = [];
  private weights: number[] = [];
  private nearAt = { x: 1e9, z: 1e9, r: 0, version: -1 };
  private version = 0;

  constructor(readonly capacity: number) {
    this.body = instanced(carGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), capacity);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 2 * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(capacity * 2 * 3), 3));
    this.lights = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        size: 3,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.lights.frustumCulled = false;
    this.lights.renderOrder = 15;
    this.root.add(this.body, this.lights);
    this.cars = Array.from({ length: capacity }, () => ({ path: null, d: 0, dir: 1, lane: 0, speed: 0, fade: 0 }));
  }

  addTile(key: number, lanes: LaneArrays, ground: HeightField, deck: DeckFinder | null) {
    this.byTile.set(key, makePaths(lanes, ground, deck));
    this.version++;
  }

  removeTile(key: number) {
    const gone = this.byTile.get(key);
    if (!gone) return;
    this.byTile.delete(key);
    const set = new Set(gone);
    for (const c of this.cars) if (c.path && set.has(c.path)) c.path = null;
    this.version++;
  }

  /** Roads within reach of (x, z), weighted by their length and how busy their class is. */
  private refreshNear(x: number, z: number, r: number) {
    const a = this.nearAt;
    if (a.version === this.version && Math.hypot(x - a.x, z - a.z) < r * 0.2 && Math.abs(r - a.r) < a.r * 0.2) return;
    Object.assign(a, { x, z, r, version: this.version });
    this.near = [];
    this.weights = [];
    let total = 0;
    for (const paths of this.byTile.values()) {
      for (const p of paths) {
        const dx = Math.max(p.x0 - x, 0, x - p.x1);
        const dz = Math.max(p.z0 - z, 0, z - p.z1);
        if (dx * dx + dz * dz > r * r) continue;
        total += p.len * CARS[p.cls].weight;
        this.near.push(p);
        this.weights.push(total);
      }
    }
  }

  private spawn(k: number, x: number, z: number, r: number, rnd: () => number): boolean {
    const c = this.cars[k];
    const n = this.near.length;
    if (!n) return false;
    const total = this.weights[n - 1];
    for (let attempt = 0; attempt < 4; attempt++) {
      const w = rnd() * total;
      let lo = 0;
      let hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.weights[mid] < w) lo = mid + 1;
        else hi = mid;
      }
      const p = this.near[lo];
      const d = rnd() * p.len;
      const i = Math.min(p.cum.length - 1, Math.max(0, Math.floor((d / p.len) * (p.cum.length - 1))));
      if (Math.hypot(p.xz[i * 2] - x, p.xz[i * 2 + 1] - z) > r) continue;
      const cls = CARS[p.cls];
      c.path = p;
      c.d = d;
      c.dir = cls.oneWay || rnd() < 0.5 ? 1 : -1;
      const lane = Math.floor(rnd() * cls.lanes);
      // One-way carriageways spread their lanes across the line; two-way roads keep right.
      c.lane = (cls.oneWay ? (lane - (cls.lanes - 1) / 2) * 3.6 : 1.9 + lane * 3.5) * M;
      c.speed = cls.speed * (0.9 + 0.2 * rnd());
      c.fade = 0;
      this.body.setColorAt(k, paint(rnd()));
      return true;
    }
    return false;
  }

  /** Advance and place every car. `lift` raises them onto the drawn street surface. */
  update(dt: number, cam: { x: number; z: number; dist: number }, night: number, lift: number, lowPower: boolean) {
    const r = Math.min(lowPower ? 2.6 : 4.2, Math.max(0.5, cam.dist * 1.4));
    this.refreshNear(cam.x, cam.z, r);
    const want = Math.min(this.capacity, Math.round(Math.PI * r * r * (lowPower ? 70 : 120)));
    const scale = Math.min(2.2, Math.max(1, cam.dist / 1.3));
    const lp = this.lights.geometry.attributes.position as THREE.BufferAttribute;
    const lc = this.lights.geometry.attributes.color as THREE.BufferAttribute;
    const dark = THREE.MathUtils.smoothstep(night, 0.35, 0.8);
    let shown = 0;
    let colorsChanged = false;
    for (let k = 0; k < this.capacity; k++) {
      const c = this.cars[k];
      if (k >= want) {
        c.path = null;
        continue;
      }
      if (c.path && Math.hypot(c.path.xz[0] - cam.x, c.path.xz[1] - cam.z) > r * 3 + c.path.len) c.path = null;
      if (!c.path) {
        if (!this.spawn(k, cam.x, cam.z, r, Math.random)) continue;
        colorsChanged = true;
      }
      const p = c.path!;
      c.d += c.dir * c.speed * dt;
      c.fade = dt > 0 ? Math.min(1, c.fade + dt / 0.8) : 1; // held still (reduced motion): just there
      const toEnd = c.dir > 0 ? p.len - c.d : c.d;
      if (toEnd <= 0) {
        c.path = null;
        continue;
      }
      // Find the segment, then the point on it and the heading.
      const cum = p.cum;
      let lo = 0;
      let hi = cum.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= c.d) lo = mid;
        else hi = mid;
      }
      const f = (c.d - cum[lo]) / (cum[hi] - cum[lo] || 1);
      const ax = p.xz[lo * 2];
      const az = p.xz[lo * 2 + 1];
      let tx = p.xz[hi * 2] - ax;
      let tz = p.xz[hi * 2 + 1] - az;
      const tl = Math.hypot(tx, tz) || 1;
      tx = (tx / tl) * c.dir;
      tz = (tz / tl) * c.dir;
      // Right of travel is (-tz, tx) with north up.
      const x = ax + (p.xz[hi * 2] - ax) * f - tz * c.lane;
      const z = az + (p.xz[hi * 2 + 1] - az) * f + tx * c.lane;
      if (Math.hypot(x - cam.x, z - cam.z) > r * 1.3) {
        c.path = null;
        continue;
      }
      const y = p.y[lo] + (p.y[hi] - p.y[lo]) * f + lift;
      const size = scale * c.fade * Math.min(1, toEnd / 0.012);
      _q.setFromAxisAngle(_up, Math.atan2(-tx, -tz));
      _m.compose(_p.set(x, y, z), _q, _s.setScalar(Math.max(1e-4, size)));
      this.body.setMatrixAt(k, _m);
      // Headlights ahead, taillights behind.
      const reach = 0.0023 * size;
      lp.setXYZ(k * 2, x + tx * reach, y + 0.0007 * size, z + tz * reach);
      lp.setXYZ(k * 2 + 1, x - tx * reach, y + 0.0008 * size, z - tz * reach);
      lc.setXYZ(k * 2, HEAD.r * c.fade, HEAD.g * c.fade, HEAD.b * c.fade);
      lc.setXYZ(k * 2 + 1, TAIL.r * c.fade, TAIL.g * c.fade, TAIL.b * c.fade);
      shown = k + 1;
    }
    // Cars without a road this frame sit invisibly where they are.
    for (let k = 0; k < shown; k++) {
      if (!this.cars[k].path) {
        this.body.setMatrixAt(k, _m.makeScale(0, 0, 0));
        lc.setXYZ(k * 2, 0, 0, 0);
        lc.setXYZ(k * 2 + 1, 0, 0, 0);
      }
    }
    this.body.count = shown;
    // Only the cars in use go to the GPU, not the whole pool.
    uploadInstances(this.body, shown, colorsChanged);
    if (shown > 0) {
      for (const a of [lp, lc]) {
        a.addUpdateRange(0, shown * 6);
        a.needsUpdate = true;
      }
    }
    this.lights.geometry.setDrawRange(0, shown * 2);
    const lm = this.lights.material as THREE.PointsMaterial;
    lm.opacity = dark;
    this.lights.visible = dark > 0.01;
  }

  dispose() {
    this.body.geometry.dispose();
    (this.body.material as THREE.Material).dispose();
    this.lights.geometry.dispose();
    (this.lights.material as THREE.Material).dispose();
  }
}
