"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BUILDING_EXAG, groundY, project, type HeightField } from "@/lib/atlas/geo";
import { runtime } from "@/lib/atlas/store";
import { sky } from "@/lib/atlas/timeOfDay";
import { box, instanced, merge } from "./figures";

// Austin-Bergstrom International: airliners on final over East Austin, touching down on the
// west runway and turning off for the terminal, departures rolling and climbing out to the south
// from the east runway, and a line of aircraft at the Barbara Jordan Terminal's gates. Landing
// lights, beacons and wingtip lights after dark.

const M = 0.001;
const SCALE = 1.5; // airliners read at airport scale
const V = BUILDING_EXAG;

// Runway thresholds (Overture base/infrastructure): 17R/35L to the west, 17L/35R to the east.
const RWY_WEST = { n: project(-97.67938, 30.21358), s: project(-97.67848, 30.17997) };
const RWY_EAST = { n: project(-97.65791, 30.20381), s: project(-97.65726, 30.17913) };
// Barbara Jordan Terminal (Overture buildings): its long south face carries most of the gates.
const [TERM_W, TERM_S] = project(-97.6715, 30.2017);
const [TERM_E, TERM_N] = project(-97.6627, 30.2026);
// The South Terminal, with its apron to the north.
const SOUTH_TERM = project(-97.67085, 30.1937);

const AIRLINE = ["#304cb2", "#c8102e", "#1a3668", "#b0173c", "#01426a", "#2e8540", "#f2b705", "#5b6770", "#e4572e"].map(
  (c) => new THREE.Color(c),
);

/** An airliner in metres, nose toward -z: the body, and the tail fin (painted per airline). */
function planeGeometry(): { body: THREE.BufferGeometry; fin: THREE.BufferGeometry } {
  const fuselage = new THREE.CylinderGeometry(2, 2, 29, 10, 1);
  fuselage.rotateX(Math.PI / 2);
  const nose = new THREE.ConeGeometry(2, 5, 10, 1);
  nose.rotateX(-Math.PI / 2);
  nose.translate(0, 0, -17);
  const tail = new THREE.ConeGeometry(2, 7, 10, 1);
  tail.rotateX(Math.PI / 2);
  tail.translate(0, 0.5, 18);
  const wing = (s: number) => {
    const w = box(15.5, 0.5, 4.2, 0, 0, 0);
    w.rotateY(s * 0.42);
    w.translate(s * 9.2, -0.6, 1.6);
    return w;
  };
  const stab = (s: number) => {
    const w = box(6.2, 0.3, 2.6, 0, 0, 0);
    w.rotateY(s * 0.45);
    w.translate(s * 3.4, 0.8, 17.2);
    return w;
  };
  const engine = (s: number) => {
    const e = new THREE.CylinderGeometry(1.15, 1.15, 4.4, 8, 1);
    e.rotateX(Math.PI / 2);
    e.translate(s * 6.2, -1.7, -1.8);
    return e;
  };
  const body = merge([fuselage, nose, tail, wing(1), wing(-1), stab(1), stab(-1), engine(1), engine(-1)]);
  const fin = box(0.45, 6.5, 4.6, 0, 0, 0);
  fin.rotateX(-0.45);
  fin.translate(0, 4.8, 16.4);
  body.scale(M * SCALE, M * SCALE, M * SCALE);
  const finG = merge([fin]);
  finG.scale(M * SCALE, M * SCALE, M * SCALE);
  return { body, fin: finG };
}

/** A scripted movement: points along the ground with altitude and speed, timed by integration. */
interface Script {
  /** x, alt (km above the runway), z per point */
  pts: Float32Array;
  /** the runway's ground (world y), which altitudes are measured from */
  refY: number;
  /** seconds at each point */
  time: Float32Array;
  /** 0..1 size per point, for appearing and leaving */
  size: Float32Array;
  /** 1 while landing lights are on */
  lights: Float32Array;
  duration: number;
}

interface PathPoint {
  x: number;
  z: number;
  alt: number;
  v: number; // km/s (time-lapsed)
  size?: number;
  lights?: number;
}

function script(points: PathPoint[], refY: number): Script {
  const n = points.length;
  const pts = new Float32Array(n * 3);
  const time = new Float32Array(n);
  const size = new Float32Array(n);
  const lights = new Float32Array(n);
  points.forEach((p, i) => {
    pts.set([p.x, p.alt, p.z], i * 3);
    size[i] = p.size ?? 1;
    lights[i] = p.lights ?? 0;
    if (i) {
      const q = points[i - 1];
      const d = Math.hypot(p.x - q.x, p.z - q.z, (p.alt - q.alt) * 0.5);
      time[i] = time[i - 1] + d / Math.max(1e-4, (p.v + q.v) / 2);
    }
  });
  return { pts, refY, time, size, lights, duration: time[n - 1] };
}

const unit = (a: [number, number], b: [number, number]) => {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l] as const;
};

/** Final approach from the north onto 17R, the rollout, and the turn off toward the terminal. */
function arrival(ground: HeightField): Script {
  const T = RWY_WEST.n;
  const [dx, dz] = unit(RWY_WEST.n, RWY_WEST.s);
  const out: PathPoint[] = [];
  const td = 0.35; // touchdown, km past the threshold
  for (let s = -9; s <= td + 1e-6; s += 0.2) {
    const toTd = td - s;
    // A 3 degree glide path, flaring over the last 400 m.
    const alt = toTd > 0.4 ? Math.tan(3 * THREE.MathUtils.DEG2RAD) * toTd : 0.021 * (toTd / 0.4) ** 2;
    out.push({ x: T[0] + dx * s, z: T[1] + dz * s, alt, v: 0.16, size: Math.min(1, (s + 9) / 0.6), lights: 1 });
  }
  const roll = 1.5;
  for (let s = 0.1; s <= roll + 1e-6; s += 0.1) {
    const p = td + s;
    out.push({ x: T[0] + dx * p, z: T[1] + dz * p, alt: 0, v: 0.16 - (0.142 * s) / roll, lights: s < 0.8 ? 1 : 0 });
  }
  // Turn left (east, toward the terminal) through a quarter circle, then taxi away.
  const end = td + roll;
  const [lx, lz] = [dz, -dx]; // left of travelling south is east
  const r = 0.12;
  const cx = T[0] + dx * end + lx * r;
  const cz = T[1] + dz * end + lz * r;
  for (let k = 1; k <= 8; k++) {
    const a = (k / 8) * (Math.PI / 2);
    // From the runway (offset -l from the centre) sweeping round to heading +l.
    const px = cx - lx * r * Math.cos(a) + dx * r * Math.sin(a);
    const pz = cz - lz * r * Math.cos(a) + dz * r * Math.sin(a);
    out.push({ x: px, z: pz, alt: 0, v: 0.018 });
  }
  const last = out[out.length - 1];
  for (let s = 0.05; s <= 0.3 + 1e-6; s += 0.05) {
    out.push({ x: last.x + lx * s, z: last.z + lz * s, alt: 0, v: 0.015, size: Math.min(1, (0.3 - s) / 0.08) });
  }
  return script(out, groundY(ground, T[0], T[1]));
}

/** From the holding point beside 17L's north end: line up, roll, and climb out to the south. */
function departure(ground: HeightField): Script {
  const T = RWY_EAST.n;
  const [dx, dz] = unit(RWY_EAST.n, RWY_EAST.s);
  const [wx, wz] = [-dz, dx]; // west of the runway: the terminal side
  const out: PathPoint[] = [];
  const r = 0.1;
  const hold = { x: T[0] + wx * (r + 0.16) + dx * 0.05, z: T[1] + wz * (r + 0.16) + dz * 0.05 };
  for (let s = 0; s <= 0.16 + 1e-6; s += 0.04) {
    out.push({ x: hold.x - wx * s, z: hold.z - wz * s, alt: 0, v: 0.012, size: Math.min(1, s / 0.08) });
  }
  // Quarter turn onto the centreline, heading south.
  const cx = T[0] + wx * r + dx * 0.05;
  const cz = T[1] + wz * r + dz * 0.05;
  for (let k = 1; k <= 8; k++) {
    const a = (k / 8) * (Math.PI / 2);
    out.push({ x: cx + wx * r * Math.cos(a) + dx * r * Math.sin(a), z: cz + wz * r * Math.cos(a) + dz * r * Math.sin(a), alt: 0, v: 0.012 });
  }
  const start = 0.05 + r;
  const rollLen = 1.7;
  for (let s = 0.1; s <= rollLen + 1e-6; s += 0.1) {
    const p = start + s;
    out.push({ x: T[0] + dx * p, z: T[1] + dz * p, alt: 0, v: Math.sqrt(0.012 ** 2 + 2 * 0.0036 * s), lights: 1 });
  }
  // Rotate and climb at about 7 degrees, easing off as it goes; fade out far to the south.
  const climbLen = 11;
  for (let s = 0.25; s <= climbLen + 1e-6; s += 0.25) {
    const p = start + rollLen + s;
    const alt = Math.tan(7 * THREE.MathUtils.DEG2RAD) * s * (1 - (0.25 * s) / climbLen);
    out.push({
      x: T[0] + dx * p,
      z: T[1] + dz * p,
      alt,
      v: 0.115 + 0.03 * (s / climbLen),
      size: Math.min(1, (climbLen - s) / 0.8),
      lights: alt < 0.6 ? 1 : 0,
    });
  }
  return script(out, groundY(ground, T[0], T[1]));
}

interface Mover {
  script: Script;
  /** seconds into its script */
  t: number;
  color: THREE.Color;
}

interface Sim {
  body: THREE.InstancedMesh;
  fin: THREE.InstancedMesh;
  lights: THREE.Points;
  movers: Mover[];
  parked: number;
  ground: HeightField;
}

const MOVERS = 6;
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Position (world) and a point a little further on, for a script at time t. Returns size and lights. */
function sample(sim: Sim, sc: Script, t: number, pos: THREE.Vector3, ahead: THREE.Vector3): [number, number] {
  const tm = sc.time;
  let lo = 0;
  let hi = tm.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tm[mid] <= t) lo = mid;
    else hi = mid;
  }
  const f = Math.min(1, Math.max(0, (t - tm[lo]) / (tm[hi] - tm[lo] || 1)));
  const at = (i: number, o: THREE.Vector3) => o.set(sc.pts[i * 3], sc.pts[i * 3 + 1], sc.pts[i * 3 + 2]);
  at(lo, pos).lerp(at(hi, _q), f);
  ahead.copy(_q);
  if (hi === lo + 1 && hi < tm.length - 1 && f > 0.5) at(hi + 1, ahead);
  // Altitude above the runway, easing onto the ground itself for the last few metres.
  const lift = (v: THREE.Vector3) => {
    const alt = v.y;
    const air = sc.refY + alt * V;
    v.y = alt < 0.03 ? THREE.MathUtils.lerp(groundY(sim.ground, v.x, v.z), air, alt / 0.03) : air;
    v.y += 0.0024 * SCALE; // on its gear
  };
  lift(pos);
  lift(ahead);
  const size = sc.size[lo] + (sc.size[hi] - sc.size[lo]) * f;
  return [size, Math.max(sc.lights[lo], sc.lights[hi])];
}

function makeSim(ground: HeightField): THREE.Group {
  const { body: bodyG, fin: finG } = planeGeometry();
  const white = new THREE.MeshLambertMaterial({ color: "#ffffff" });
  const paint = new THREE.MeshLambertMaterial({ color: "#ffffff" });
  const gates: { x: number; z: number; heading: number }[] = [];
  // Nose-in along the south face, and at the ends of the north face.
  for (let x = TERM_W + 0.04; x <= TERM_E - 0.04; x += 0.066) gates.push({ x, z: TERM_S + 0.045, heading: 0 });
  for (let x = TERM_W + 0.04; x <= TERM_E - 0.04; x += 0.066) {
    if (x < TERM_W + 0.17 || x > TERM_E - 0.17) gates.push({ x, z: TERM_N - 0.045, heading: Math.PI });
  }
  gates.push({ x: SOUTH_TERM[0] - 0.03, z: SOUTH_TERM[1] - 0.09, heading: Math.PI });
  gates.push({ x: SOUTH_TERM[0] + 0.04, z: SOUTH_TERM[1] - 0.09, heading: Math.PI });
  const rnd = mulberry(7);
  const parked = gates.filter(() => rnd() < 0.72);
  const n = parked.length + MOVERS;
  const body = instanced(bodyG, white, n);
  const fin = instanced(finG, paint, n);
  parked.forEach((g, i) => {
    // heading 0 faces north (-z).
    _quat.setFromAxisAngle(_up, -g.heading);
    _p.set(g.x, groundY(ground, g.x, g.z) + 0.0024 * SCALE, g.z);
    _m.compose(_p, _quat, _s.set(1, 1, 1));
    body.setMatrixAt(i, _m);
    fin.setMatrixAt(i, _m);
    body.setColorAt(i, new THREE.Color("#f3f2ee"));
    fin.setColorAt(i, AIRLINE[Math.floor(rnd() * AIRLINE.length)]);
  });
  body.count = fin.count = n;

  const arr = arrival(ground);
  const dep = departure(ground);
  const movers: Mover[] = [];
  // Staggered so there is usually one on final, one rolling and one climbing out.
  for (let k = 0; k < MOVERS / 2; k++) {
    movers.push({ script: arr, t: (arr.duration * k) / (MOVERS / 2), color: AIRLINE[(k * 3 + 1) % AIRLINE.length] });
    movers.push({ script: dep, t: (dep.duration * (k + 0.5)) / (MOVERS / 2), color: AIRLINE[(k * 3 + 2) % AIRLINE.length] });
  }

  const lightGeo = new THREE.BufferGeometry();
  lightGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MOVERS * 4 * 3), 3));
  lightGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MOVERS * 4 * 3), 3));
  const lights = new THREE.Points(
    lightGeo,
    new THREE.PointsMaterial({
      size: 4,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  lights.frustumCulled = false;
  lights.renderOrder = 16;

  const root = new THREE.Group();
  root.add(body, fin, lights);
  root.userData.sim = { body, fin, lights, movers, parked: parked.length, ground } satisfies Sim;
  return root;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AIRPORT = project(-97.6699, 30.1945);
const WHITE = new THREE.Color("#fff6e0");
const RED = new THREE.Color("#ff3b2f");
const GREEN = new THREE.Color("#3dff7a");

export default function Airport({ ground }: { ground: HeightField }) {
  const ref = useRef<THREE.Group>(null);
  const root = useMemo(() => makeSim(ground), [ground]);

  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const cam = runtime.cam;
    // Only when the airport could be in view: close enough, or its approach overhead.
    const near = Math.hypot(cam.x - AIRPORT[0], cam.z - (AIRPORT[1] - 4)) < 12 + cam.dist * 0.9;
    g.visible = near;
    if (!near) return;
    const sim = g.userData.sim as Sim;
    const step = runtime.reducedMotion ? 0 : Math.min(dt, 0.1);
    const lp = sim.lights.geometry.attributes.position as THREE.BufferAttribute;
    const lc = sim.lights.geometry.attributes.color as THREE.BufferAttribute;
    const night = sky.uNight.value;
    const blink = Math.sin(sky.uTime.value * 5.5) > 0.6 ? 1 : 0;
    sim.movers.forEach((m, k) => {
      m.t = (m.t + step) % m.script.duration;
      const [size, landing] = sample(sim, m.script, m.t, _p, _q);
      const i = sim.parked + k;
      const dx = _q.x - _p.x;
      const dz = _q.z - _p.z;
      const dy = _q.y - _p.y;
      const heading = Math.atan2(dx, -dz);
      const pitch = Math.atan2(dy, Math.hypot(dx, dz) || 1e-6);
      _quat.setFromEuler(_e.set(pitch, -heading, 0, "YXZ"));
      // In the air they grow a little with distance, so an approach still reads from downtown.
      const airborne = THREE.MathUtils.smoothstep(_p.y - groundY(sim.ground, _p.x, _p.z), 0.01, 0.08);
      const boost = 1 + airborne * THREE.MathUtils.clamp((cam.dist - 2.5) / 5, 0, 1.2);
      _m.compose(_p, _quat, _s.setScalar(Math.max(1e-4, size * boost)));
      sim.body.setMatrixAt(i, _m);
      sim.fin.setMatrixAt(i, _m);
      sim.body.setColorAt(i, WHITE);
      sim.fin.setColorAt(i, m.color);
      // Lights: landing light ahead of the nose, the beacon, and the wingtips.
      const fx = Math.sin(heading);
      const fz = -Math.cos(heading);
      const span = 0.017 * SCALE * size;
      const put = (j: number, x: number, y: number, z: number, c: THREE.Color, on: number) => {
        lp.setXYZ(k * 4 + j, x, y, z);
        lc.setXYZ(k * 4 + j, c.r * on, c.g * on, c.b * on);
      };
      put(0, _p.x + fx * 0.02, _p.y, _p.z + fz * 0.02, WHITE, landing * size * 1.4);
      put(1, _p.x, _p.y + 0.004, _p.z, RED, blink * size);
      put(2, _p.x + fz * span, _p.y, _p.z - fx * span, RED, size * 0.8);
      put(3, _p.x - fz * span, _p.y, _p.z + fx * span, GREEN, size * 0.8);
    });
    sim.body.instanceMatrix.needsUpdate = true;
    sim.fin.instanceMatrix.needsUpdate = true;
    if (sim.body.instanceColor) sim.body.instanceColor.needsUpdate = true;
    if (sim.fin.instanceColor) sim.fin.instanceColor.needsUpdate = true;
    lp.needsUpdate = true;
    lc.needsUpdate = true;
    const lm = sim.lights.material as THREE.PointsMaterial;
    lm.opacity = THREE.MathUtils.smoothstep(night, 0.25, 0.7);
    lm.size = 3 + (1 - sky.uZoomOut.value) * 3;
    sim.lights.visible = lm.opacity > 0.01;
  });

  return <primitive ref={ref} object={root} />;
}
