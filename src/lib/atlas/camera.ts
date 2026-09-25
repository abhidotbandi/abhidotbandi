import * as THREE from "three";
import { clamp } from "./geo";

/** Orbit-style camera state: a ground target plus distance, tilt and bearing. */
export interface CamState {
  x: number;
  z: number;
  /** km from target */
  dist: number;
  /** degrees from straight down */
  tilt: number;
  /** degrees clockwise from north; direction the camera faces */
  bearing: number;
}

const DEG = Math.PI / 180;

export function cloneCam(c: CamState): CamState {
  return { x: c.x, z: c.z, dist: c.dist, tilt: c.tilt, bearing: c.bearing };
}

/** Place a camera for a state. `groundY` is the terrain height at the target. */
export function applyCam(camera: THREE.Camera, c: CamState, groundY: number, target = new THREE.Vector3()) {
  const t = c.tilt * DEG;
  const b = c.bearing * DEG;
  const horiz = Math.sin(t) * c.dist;
  // Facing bearing b means the camera sits "behind" the target: opposite direction.
  const cx = c.x - Math.sin(b) * horiz;
  const cz = c.z + Math.cos(b) * horiz;
  target.set(c.x, groundY, c.z);
  camera.position.set(cx, groundY + Math.cos(t) * c.dist, cz);
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  return target;
}

/** Recover a CamState from a camera looking at a target (e.g. after MapControls). */
export function camFromPose(position: THREE.Vector3, target: THREE.Vector3): CamState {
  const dx = position.x - target.x;
  const dy = position.y - target.y;
  const dz = position.z - target.z;
  const dist = Math.max(1e-4, Math.hypot(dx, dy, dz));
  const tilt = Math.acos(clamp(dy / dist, -1, 1)) / DEG;
  const bearing = Math.atan2(-dx, dz) / DEG;
  return { x: target.x, z: target.z, dist, tilt, bearing };
}

export function wrapDeg(a: number): number {
  return ((((a + 180) % 360) + 360) % 360) - 180;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapDeg(b - a) * t;
}

export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * Smooth zoom-pan path between two views (van Wijk & Nuij 2003, the curve behind
 * d3.interpolateZoom and Mapbox flyTo). Long hops pull back, pan, then push in.
 * `S` is the path length, used to give longer flights more scroll.
 */
export interface Flight {
  S: number;
  at: (t: number) => CamState;
}

const RHO = Math.SQRT2;
const RHO2 = 2;
const RHO4 = 4;

export function flight(a: CamState, b: CamState): Flight {
  const w0 = a.dist;
  const w1 = b.dist;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d2 = dx * dx + dz * dz;
  let S: number;
  let path: (s: number) => [number, number];

  if (d2 < 1e-10) {
    S = Math.log(w1 / w0) / RHO;
    path = (s) => [0, w0 * Math.exp(RHO * s)];
  } else {
    const d1 = Math.sqrt(d2);
    const b0 = (w1 * w1 - w0 * w0 + RHO4 * d2) / (2 * w0 * RHO2 * d1);
    const b1 = (w1 * w1 - w0 * w0 - RHO4 * d2) / (2 * w1 * RHO2 * d1);
    const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
    const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
    S = (r1 - r0) / RHO;
    path = (s) => {
      const u = (w0 / (RHO2 * d1)) * (Math.cosh(r0) * Math.tanh(RHO * s + r0) - Math.sinh(r0));
      return [u, (w0 * Math.cosh(r0)) / Math.cosh(RHO * s + r0)];
    };
  }
  const absS = Math.abs(S);
  // How much to flatten the view mid-flight on long hops (reads as "gaining altitude").
  const lift = clamp(absS / 4, 0, 1) * 0.45;

  return {
    S: absS,
    at(t: number) {
      const e = easeInOutCubic(t);
      const [u, w] = path(e * S);
      const f = d2 < 1e-10 ? e : u;
      const k = smoothstep(t);
      return {
        x: a.x + f * dx,
        z: a.z + f * dz,
        dist: w,
        tilt: (a.tilt + (b.tilt - a.tilt) * k) * (1 - lift * Math.sin(Math.PI * e)),
        bearing: lerpAngle(a.bearing, b.bearing, k),
      };
    },
  };
}

/** Frame-rate independent exponential damping toward a target state. */
export function dampCam(cur: CamState, target: CamState, lambda: number, dt: number) {
  const k = 1 - Math.exp(-lambda * dt);
  cur.x += (target.x - cur.x) * k;
  cur.z += (target.z - cur.z) * k;
  // Damp distance in log space so zooms feel even at every scale.
  cur.dist = Math.exp(Math.log(cur.dist) + (Math.log(target.dist) - Math.log(cur.dist)) * k);
  cur.tilt += (target.tilt - cur.tilt) * k;
  cur.bearing += wrapDeg(target.bearing - cur.bearing) * k;
}
