"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { sampleWaterKm, type Central, type Dock } from "@/lib/atlas/central";
import { groundY, type HeightField } from "@/lib/atlas/geo";
import { Path, nearestIndex, rowingLoop } from "@/lib/atlas/paths";
import { runtime } from "@/lib/atlas/store";
import { SHIRTS, SKIN, bodyGeo, box, headGeo, inWindow, merge, pick, standGeo } from "./figures";

// Life on Lady Bird Lake: rowing crews on their loops (busiest at dawn), paddleboards, kayaks
// and canoes wandering out from the rental docks, the Lone Star Riverboat by day and bat-watching
// boats under the Congress Avenue Bridge at dusk. Everything is modelled in metres and scaled up
// with camera distance so it still reads at downtown zoom.

type Kind = "eight" | "four" | "single" | "sup" | "kayak" | "canoe" | "pontoon";

interface Spec {
  length: number; // m
  width: number;
  depth: number;
  seats: number;
  sweep: boolean; // one oar per rower, alternating sides
  scull: boolean; // two oars per rower
  speed: number; // m/s (time-lapsed a little)
  rate: number; // strokes per second
  maxScale: number; // exaggeration cap
}

const SPECS: Record<Kind, Spec> = {
  eight: { length: 17.7, width: 0.62, depth: 0.32, seats: 8, sweep: true, scull: false, speed: 9, rate: 0.55, maxScale: 2.4 },
  four: { length: 12.8, width: 0.58, depth: 0.3, seats: 4, sweep: false, scull: true, speed: 8, rate: 0.5, maxScale: 2.6 },
  single: { length: 8.2, width: 0.42, depth: 0.26, seats: 1, sweep: false, scull: true, speed: 7, rate: 0.48, maxScale: 3.2 },
  sup: { length: 3.3, width: 0.82, depth: 0.14, seats: 1, sweep: false, scull: false, speed: 2.2, rate: 0.7, maxScale: 5 },
  kayak: { length: 4.0, width: 0.72, depth: 0.32, seats: 1, sweep: false, scull: false, speed: 3.2, rate: 0.9, maxScale: 5 },
  canoe: { length: 5.0, width: 0.92, depth: 0.38, seats: 2, sweep: false, scull: false, speed: 2.6, rate: 0.6, maxScale: 4.5 },
  pontoon: { length: 9.0, width: 3.2, depth: 0.7, seats: 8, sweep: false, scull: false, speed: 0.9, rate: 0, maxScale: 3 },
};

interface Boat {
  kind: Kind;
  spec: Spec;
  path: Path | null; // rowing loop or creek line, or null for wanderers
  pong: number; // 0 on loops; +1/-1 direction when paddling up and down an open path
  lateral: number; // km off the path line
  d: number; // km along the path
  x: number;
  z: number;
  hx: number; // heading unit vector
  hz: number;
  turn: number; // wander steering state
  homeX: number;
  homeZ: number;
  leash: number; // km
  phase: number;
  side: number; // current paddle side for SUPs and canoes
  strokes: number;
  window: [number, number]; // time of day it's out on the water
  show: number;
  hull: THREE.Color;
  blade: THREE.Color;
  crew: THREE.Color[];
  skin: THREE.Color[];
  lastPhase: number;
}

const SHELL_HULLS = ["#f4f1ea", "#f4f1ea", "#e8c34a", "#c8352e", "#1d2b4f"];
const BLADES = ["#bf5700", "#f4f1ea", "#1d2b4f", "#c8352e", "#e8c34a"];
const BOARDS = ["#f4f1ea", "#3fb7b0", "#f07a5a", "#f2c230", "#8fd3e8"];
const KAYAKS = ["#d9412f", "#f2c230", "#f28c28", "#8cc63f", "#2a9d8f", "#3b6fd1"];
const CANOES = ["#2f6b4f", "#b8bdc2", "#c8352e"];

function col(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

/** Nearest point that is well out on the water from a dock on the bank. */
function launchPoint(c: Central, x: number, z: number, minKm: number): [number, number] | null {
  for (let r = 0.005; r < 0.35; r += 0.005) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (sampleWaterKm(c, px, pz) > minKm) return [px, pz];
    }
  }
  return null;
}

function makeBoats(c: Central, lowPower: boolean): { boats: Boat[]; riverboat: Path | null } {
  const rnd = Math.random;
  const boats: Boat[] = [];
  const lbl = c.rivers.ladybird;
  const base = (kind: Kind): Boat => {
    const spec = SPECS[kind];
    const n = Math.max(spec.seats, 1) + (kind === "eight" ? 1 : 0);
    return {
      kind,
      spec,
      path: null,
      pong: 0,
      lateral: 0,
      d: 0,
      x: 0,
      z: 0,
      hx: 1,
      hz: 0,
      turn: 0,
      homeX: 0,
      homeZ: 0,
      leash: 0.6,
      phase: rnd(),
      side: rnd() < 0.5 ? -1 : 1,
      strokes: 0,
      window: [0, 1],
      show: 0,
      hull: col("#f4f1ea"),
      blade: col("#f4f1ea"),
      crew: Array.from({ length: n }, () => col(pick(SHIRTS, rnd()))),
      skin: Array.from({ length: n }, () => pick(SKIN, rnd()).clone()),
      lastPhase: 0,
    };
  };

  // Rowing crews on loops between the bridges, keeping right. Most row at dawn, some at dusk.
  if (lbl) {
    const idx = (lon: number, lat: number) => {
      const x = (lon + 97.7431) * 96.2;
      const z = -(lat - 30.2672) * 110.574;
      return nearestIndex(lbl.line, x, z);
    };
    const ends: [number, number][] = [
      [idx(-97.7795, 30.2794), idx(-97.7366, 30.2556)], // MoPac to I-35
      [idx(-97.7700, 30.2728), idx(-97.7440, 30.2615)], // Deep Eddy to Congress
      [idx(-97.7620, 30.2690), idx(-97.7230, 30.2480)], // Lamar to Holly
    ];
    const nShells = lowPower ? 7 : 14;
    for (let i = 0; i < nShells; i++) {
      const kind: Kind = i % 3 === 0 ? "eight" : i % 3 === 1 ? "single" : "four";
      const b = base(kind);
      const [i0, i1] = ends[i % ends.length];
      b.path = rowingLoop(lbl, i0, i1, 0.2 + rnd() * 0.75, 0.03);
      b.d = rnd() * b.path.length;
      b.hull = col(pick(SHELL_HULLS, rnd()));
      b.blade = col(pick(BLADES, rnd()));
      const dusk = i % 4 === 3;
      b.window = dusk ? [0.62 + rnd() * 0.08, 0.8 + rnd() * 0.05] : [0.03 + rnd() * 0.06, 0.3 + rnd() * 0.14];
      boats.push(b);
    }
  }

  // Paddlers from the rental docks: paddleboards and kayaks on the lake, canoes on Barton Creek.
  const perDock: Record<Dock["kind"], [Kind, number][]> = {
    paddle: [
      ["sup", 7],
      ["kayak", 5],
    ],
    rowing: [
      ["kayak", 4],
      ["sup", 2],
    ],
    canoe: [
      ["canoe", 4],
      ["kayak", 3],
      ["sup", 3],
    ],
    riverboat: [],
  };
  const creek = c.rivers.barton ? new Path(c.rivers.barton.line) : null;
  for (const dock of c.docks) {
    const start = launchPoint(c, dock.x, dock.z, dock.kind === "canoe" ? 0.005 : 0.012);
    if (!start) continue;
    for (const [kind, count] of perDock[dock.kind]) {
      const n = lowPower ? Math.ceil(count / 2) : count;
      for (let i = 0; i < n; i++) {
        const b = base(kind);
        if (dock.kind === "canoe" && creek && i < Math.ceil(n * 0.7)) {
          // Barton Creek is ~25 m wide: paddle up and down its line to the lake and back.
          b.path = creek;
          b.pong = rnd() < 0.5 ? 1 : -1;
          b.d = rnd() * creek.length;
          b.lateral = (rnd() - 0.5) * 0.008;
          b.hull = col(kind === "sup" ? pick(BOARDS, rnd()) : kind === "kayak" ? pick(KAYAKS, rnd()) : pick(CANOES, rnd()));
          b.blade = col(pick(["#20242b", "#f4f1ea", "#f2c230"], rnd()));
          b.window = [0.2 + rnd() * 0.12, 0.72 + rnd() * 0.12];
          boats.push(b);
          continue;
        }
        const a = rnd() * Math.PI * 2;
        const r = 0.02 + rnd() * 0.12;
        const px = start[0] + Math.cos(a) * r;
        const pz = start[1] + Math.sin(a) * r;
        [b.x, b.z] = sampleWaterKm(c, px, pz) > 0.008 ? [px, pz] : start;
        b.hx = Math.cos(a);
        b.hz = Math.sin(a);
        b.homeX = start[0];
        b.homeZ = start[1];
        b.leash = dock.kind === "canoe" ? 0.45 : 0.75;
        b.hull = col(kind === "sup" ? pick(BOARDS, rnd()) : kind === "kayak" ? pick(KAYAKS, rnd()) : pick(CANOES, rnd()));
        b.blade = col(pick(["#20242b", "#f4f1ea", "#f2c230"], rnd()));
        b.window = [0.17 + rnd() * 0.18, 0.72 + rnd() * 0.15];
        boats.push(b);
      }
    }
  }

  // Bat-watching boats gather either side of the Congress Avenue Bridge at dusk.
  const bridge = { x: (-97.74506 + 97.7431) * 96.2, z: -(30.26215 - 30.2672) * 110.574 };
  for (let i = 0; i < (lowPower ? 3 : 6); i++) {
    const b = base("pontoon");
    const side = i % 2 === 0 ? -1 : 1;
    const p = launchPoint(c, bridge.x + side * 0.09, bridge.z + (rnd() - 0.5) * 0.04, 0.03);
    if (!p) continue;
    [b.x, b.z] = p;
    b.homeX = p[0];
    b.homeZ = p[1];
    b.leash = 0.07;
    b.hx = 1;
    b.hz = 0;
    b.hull = col("#f4f1ea");
    b.blade = col(i % 3 === 0 ? "#c8352e" : "#2f6fb0");
    b.window = [0.8 + rnd() * 0.02, 0.92 + rnd() * 0.02];
    boats.push(b);
  }

  // The Lone Star Riverboat cruises between Lamar and I-35 by day.
  let riverboat: Path | null = null;
  if (lbl) {
    const i0 = nearestIndex(lbl.line, (-97.7565 + 97.7431) * 96.2, -(30.2656 - 30.2672) * 110.574);
    const i1 = nearestIndex(lbl.line, (-97.7372 + 97.7431) * 96.2, -(30.2556 - 30.2672) * 110.574);
    riverboat = rowingLoop(lbl, i0, i1, 0.05, 0.04);
  }
  return { boats, riverboat };
}

// ---------------------------------------------------------------- geometry (metres)

/** A pointed hull: bow at +z, deck at y = 1, keel at y = 0; unit length and width. */
function hullGeometry(): THREE.BufferGeometry {
  const stations = 12;
  const pos: number[] = [];
  const ring = (i: number) => {
    const t = i / stations; // 0 stern .. 1 bow
    const z = t - 0.5;
    const w = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * t - 1), 2.4)), 0.55) * 0.5;
    return { z, w };
  };
  for (let i = 0; i < stations; i++) {
    const a = ring(i);
    const b = ring(i + 1);
    // two sides: deck edge down to the keel
    pos.push(-a.w, 1, a.z, 0, 0, a.z, -b.w, 1, b.z);
    pos.push(-b.w, 1, b.z, 0, 0, a.z, 0, 0, b.z);
    pos.push(a.w, 1, a.z, b.w, 1, b.z, 0, 0, a.z);
    pos.push(b.w, 1, b.z, 0, 0, b.z, 0, 0, a.z);
    // deck
    pos.push(-a.w, 1, a.z, -b.w, 1, b.z, a.w, 1, a.z);
    pos.push(a.w, 1, a.z, -b.w, 1, b.z, b.w, 1, b.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Oar or paddle: shaft along +x from the pivot, blade at the end; unit length. */
function oarGeo(): THREE.BufferGeometry {
  return merge([box(1, 0.02, 0.02, 0.5, 0, 0), box(0.16, 0.012, 0.09, 0.92, 0, 0)]);
}

// ---------------------------------------------------------------- water marks

const markVertex = /* glsl */ `
  attribute float aFade;
  varying vec2 vUv;
  varying float vFade;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vFade = aFade;
    vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

// Kelvin wake: two arms at ~19.5 degrees, plus a churned centre line.
const wakeFragment = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vFade;
  #include <fog_pars_fragment>
  void main() {
    float u = vUv.x - 0.5;      // across
    float v = vUv.y;            // 0 at the stern, 1 at the far end
    float arm = abs(abs(u) - v * 0.5);
    float w = 0.01 + v * 0.025;
    float a = (1.0 - smoothstep(w * 0.4, w, arm)) * pow(1.0 - v, 1.6) * 0.75;
    a += (1.0 - smoothstep(0.0, 0.05 + v * 0.05, abs(u))) * (1.0 - smoothstep(0.0, 0.4, v)) * 0.4;
    a *= vFade * smoothstep(0.0, 0.04, v);
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

// Puddles and paddle rings: an expanding, fading ring.
const ringFragment = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vFade;
  #include <fog_pars_fragment>
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float age = 1.0 - vFade;
    float rad = 0.25 + age * 0.7;
    float a = (1.0 - smoothstep(0.0, 0.09, abs(r - rad))) * vFade * 0.7;
    a += (1.0 - smoothstep(0.0, rad * 0.8, r)) * vFade * vFade * 0.25;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

function markMaterial(fragment: string, color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: markVertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uColor: { value: new THREE.Color(color) },
    },
  });
}

function flatQuad(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}

// ---------------------------------------------------------------- the component

const MAX_RINGS = 360;

interface Pools {
  hulls: THREE.InstancedMesh;
  bodies: THREE.InstancedMesh;
  standing: THREE.InstancedMesh;
  heads: THREE.InstancedMesh;
  oars: THREE.InstancedMesh;
  wakes: THREE.InstancedMesh;
  rings: THREE.InstancedMesh;
  canopies: THREE.InstancedMesh;
  riverboat: THREE.Group;
  wheel: THREE.Object3D;
}

function makePools(nBoats: number): Pools {
  const lambert = () => new THREE.MeshLambertMaterial({ color: "#ffffff" });
  const im = (g: THREE.BufferGeometry, m: THREE.Material, n: number) => {
    const mesh = new THREE.InstancedMesh(g, m, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    return mesh;
  };
  const people = nBoats * 10;
  const hulls = im(hullGeometry(), lambert(), nBoats);
  const bodies = im(bodyGeo(), lambert(), people);
  const standing = im(standGeo(), lambert(), people);
  const heads = im(headGeo(), lambert(), people * 2);
  const oars = im(oarGeo(), lambert(), people * 2);
  const canopies = im(box(1, 1, 1, 0, 0.5, 0), lambert(), nBoats);
  for (const m of [hulls, bodies, standing, heads, oars, canopies]) {
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count * 3), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  const wakeGeo = flatQuad();
  wakeGeo.translate(0, 0, -0.5); // stern at the origin, trailing behind (-z)
  const wakes = im(wakeGeo, markMaterial(wakeFragment, "#f6f8f4"), nBoats);
  wakes.geometry.setAttribute("aFade", new THREE.InstancedBufferAttribute(new Float32Array(nBoats), 1));
  const rings = im(flatQuad(), markMaterial(ringFragment, "#f6f8f4"), MAX_RINGS);
  rings.geometry.setAttribute("aFade", new THREE.InstancedBufferAttribute(new Float32Array(MAX_RINGS), 1));
  // Unspawned rings: zero size, so they cost nothing to rasterise.
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < MAX_RINGS; i++) rings.setMatrixAt(i, zero);
  wakes.renderOrder = rings.renderOrder = 8;

  // The Lone Star Riverboat: a white double-decker with a red stern paddlewheel.
  const white = new THREE.MeshLambertMaterial({ color: "#f4f1ea" });
  const red = new THREE.MeshLambertMaterial({ color: "#b8322a" });
  const dark = new THREE.MeshLambertMaterial({ color: "#3b4148" });
  const riverboat = new THREE.Group();
  const add = (g: THREE.BufferGeometry, m: THREE.Material) => riverboat.add(new THREE.Mesh(g, m));
  add(box(6, 1.2, 19, 0, 0.6, 0), white);
  add(box(6.1, 0.35, 19.1, 0, 1.1, 0), red);
  add(box(5, 2.3, 14, 0, 2.35, 0.6), white);
  add(box(5.1, 0.6, 14.1, 0, 2.2, 0.6), dark);
  add(box(5.4, 0.25, 15, 0, 3.6, 0.2), red);
  add(box(3.4, 1.4, 5, 0, 4.4, 3.8), white);
  add(box(3.6, 0.2, 5.2, 0, 5.2, 3.8), red);
  const wheel = new THREE.Group();
  for (let k = 0; k < 8; k++) {
    const blade = new THREE.Mesh(box(4.6, 0.12, 1.3, 0, 0, 0), red);
    blade.rotation.x = (k / 8) * Math.PI * 2;
    blade.position.set(0, Math.sin((k / 8) * Math.PI * 2) * 1.1, Math.cos((k / 8) * Math.PI * 2) * 1.1);
    wheel.add(blade);
  }
  wheel.position.set(0, 1.3, -10.6);
  riverboat.add(wheel);
  riverboat.visible = false;
  return { hulls, bodies, standing, heads, oars, wakes, rings, canopies, riverboat, wheel };
}

/** Oar sweep angle (+ toward the bow) and blade lift through one stroke. */
function stroke(p: number): { angle: number; lift: number; slide: number } {
  const drive = 0.38;
  if (p < drive) {
    const t = p / drive;
    const e = t * t * (3 - 2 * t);
    return { angle: 0.72 - 1.34 * e, lift: t < 0.08 ? 1 - t / 0.08 : 0, slide: -0.3 + 0.6 * e };
  }
  const t = (p - drive) / (1 - drive);
  const e = t * t * (3 - 2 * t);
  return { angle: -0.62 + 1.34 * e, lift: t > 0.92 ? (1 - t) / 0.08 : Math.min(1, t / 0.1), slide: 0.3 - 0.6 * e };
}

const tmpBoat = new THREE.Matrix4();
const tmpLocal = new THREE.Matrix4();
const tmpOut = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e3 = new THREE.Euler();
const v3 = new THREE.Vector3();
const s3 = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0);
const probe = { x: 0, z: 0, dx: 0, dz: 0 };

interface Sim {
  boats: Boat[];
  riverboatPath: Path | null;
  pools: Pools;
  ringHead: number;
}

/** Builds everything once; the simulation state rides along on the group's userData. */
function makeRiver(central: Central, lowPower: boolean): THREE.Group {
  const { boats, riverboat } = makeBoats(central, lowPower);
  const pools = makePools(boats.length);
  const root = new THREE.Group();
  root.add(pools.hulls, pools.bodies, pools.standing, pools.heads, pools.oars, pools.canopies, pools.wakes, pools.rings, pools.riverboat);
  root.userData.sim = { boats, riverboatPath: riverboat, pools, ringHead: 0 } satisfies Sim;
  return root;
}

export default function RiverLife({
  central,
  ground,
  lowPower,
}: {
  central: Central;
  ground: HeightField;
  lowPower: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  const root = useMemo(() => makeRiver(central, lowPower), [central, lowPower]);

  useFrame((state, rawDt) => {
    const g = ref.current;
    if (!g) return;
    const sim = g.userData.sim as Sim;
    const { boats, riverboatPath, pools } = sim;
    const cam = runtime.cam;
    // Only worth drawing near the river and below a few kilometres up.
    const near = Math.hypot(cam.x + 1.0, cam.z - 0.3) < 9 && cam.dist < 8;
    g.visible = near;
    if (!near) return;
    const dt = runtime.reducedMotion ? 0 : Math.min(rawDt, 0.1);
    // Reduced motion: boats hold still, oars and paddles too.
    const t = runtime.reducedMotion ? 0 : state.clock.elapsedTime;
    const tod = runtime.tod;
    // Exaggeration: true size up close, growing with distance so crews and paddlers stay a few
    // pixels across. Lengths (seat spacing, oars) are capped harder than thickness, so shells
    // don't overrun the river while their people stay visible.
    const E = Math.min(9, Math.max(1, cam.dist / 0.28));
    const { hulls, bodies, standing, heads, oars, wakes, rings, canopies, riverboat, wheel } = pools;
    let nh = 0;
    let nb = 0;
    let ns = 0;
    let nhd = 0;
    let no = 0;
    let nw = 0;
    let nc = 0;
    const wakeFade = wakes.geometry.getAttribute("aFade") as THREE.InstancedBufferAttribute;
    const ringFade = rings.geometry.getAttribute("aFade") as THREE.InstancedBufferAttribute;

    const put = (mesh: THREE.InstancedMesh, i: number, m: THREE.Matrix4, color: THREE.Color) => {
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color);
    };
    const part = (x: number, y: number, z: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number) => {
      e3.set(rx, ry, rz, "YZX");
      q.setFromEuler(e3);
      tmpLocal.compose(v3.set(x, y, z), q, s3.set(sx, sy, sz));
      return tmpOut.multiplyMatrices(tmpBoat, tmpLocal);
    };
    const spawnRing = (lx: number, lz: number, size: number) => {
      // local boat coords (m) -> world
      v3.set(lx, 0.02, lz).applyMatrix4(tmpBoat);
      const i = sim.ringHead;
      sim.ringHead = (i + 1) % MAX_RINGS;
      tmpLocal.compose(v3, q.identity(), s3.set(size * E * 0.001, 1, size * E * 0.001));
      rings.setMatrixAt(i, tmpLocal);
      ringFade.setX(i, 1);
    };

    for (const b of boats) {
      const spec = b.spec;
      const want = inWindow(tod, b.window);
      // Launch and land smoothly; reduced motion just shows who's out.
      b.show += (want - b.show) * (runtime.reducedMotion ? 1 : 1 - Math.exp(-3 * Math.max(dt, 0.016)));
      if (b.show < 0.02) continue;

      // Move.
      if (b.path) {
        if (b.pong) {
          b.d += (spec.speed / 1000) * dt * b.pong;
          if (b.d > b.path.length - 0.01 || b.d < 0.01) b.pong *= -1;
        } else {
          b.d += (spec.speed / 1000) * dt;
        }
        b.path.at(b.d, probe);
        const dir = b.pong || 1;
        b.x = probe.x - probe.dz * b.lateral;
        b.z = probe.z + probe.dx * b.lateral;
        // Ease the heading round corners; with reduced motion just face along the path.
        const ease = runtime.reducedMotion ? 1 : Math.min(1, dt * 2);
        b.hx += (probe.dx * dir - b.hx) * ease;
        b.hz += (probe.dz * dir - b.hz) * ease;
        const hl = Math.hypot(b.hx, b.hz) || 1;
        b.hx /= hl;
        b.hz /= hl;
      } else if (dt > 0) {
        // Wander, turning away from the bank and back toward home when far.
        const look = 0.03;
        const ahead = sampleWaterKm(central, b.x + b.hx * look, b.z + b.hz * look);
        const margin = b.kind === "pontoon" ? 0.02 : 0.012;
        b.turn += (Math.random() - 0.5) * dt * 1.2;
        b.turn *= 0.98;
        if (ahead < margin) {
          const lx = b.x + (b.hx * Math.cos(0.7) - b.hz * Math.sin(0.7)) * look;
          const lz = b.z + (b.hx * Math.sin(0.7) + b.hz * Math.cos(0.7)) * look;
          const rx = b.x + (b.hx * Math.cos(-0.7) - b.hz * Math.sin(-0.7)) * look;
          const rz = b.z + (b.hx * Math.sin(-0.7) + b.hz * Math.cos(-0.7)) * look;
          b.turn = sampleWaterKm(central, lx, lz) > sampleWaterKm(central, rx, rz) ? 0.9 : -0.9;
        }
        const hd = Math.hypot(b.x - b.homeX, b.z - b.homeZ);
        if (hd > b.leash) {
          const want = Math.atan2(b.homeZ - b.z, b.homeX - b.x);
          const cur = Math.atan2(b.hz, b.hx);
          const diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
          b.turn = THREE.MathUtils.clamp(diff, -0.6, 0.6);
        }
        const a = Math.atan2(b.hz, b.hx) + b.turn * dt;
        b.hx = Math.cos(a);
        b.hz = Math.sin(a);
        const step = (spec.speed / 1000) * dt * (b.kind === "pontoon" ? 0.4 : 1);
        const nx = b.x + b.hx * step;
        const nz = b.z + b.hz * step;
        if (sampleWaterKm(central, nx, nz) > 0.004) {
          b.x = nx;
          b.z = nz;
        } else {
          b.turn = b.turn >= 0 ? 1.2 : -1.2;
        }
      }

      const L = Math.min(E, spec.maxScale);
      const k = b.show * L;
      const T = Math.max(1.5, E / L); // extra thickness for hulls, people and oar shafts
      const yaw = Math.atan2(b.hx, b.hz);
      const y = groundY(ground, b.x, b.z) + 0.00002;
      q.setFromAxisAngle(yAxis, yaw);
      tmpBoat.compose(v3.set(b.x, y, b.z), q, s3.setScalar(k * 0.001));

      // Hull.
      put(hulls, nh++, part(0, -spec.depth * 0.45 * T, 0, 0, 0, 0, spec.width * T, spec.depth * T, spec.length), b.hull);
      // Wake, strongest when moving.
      const small = b.kind === "sup" || b.kind === "kayak" || b.kind === "canoe";
      const wakeLen = spec.length * (small ? 3.4 : 4.6);
      tmpLocal.compose(v3.set(0, 0.03, -spec.length / 2), q.identity(), s3.set(wakeLen * 0.5 * Math.sqrt(T), 1, wakeLen));
      wakes.setMatrixAt(nw, tmpOut.multiplyMatrices(tmpBoat, tmpLocal));
      wakeFade.setX(nw++, b.kind === "pontoon" ? 0.2 : small ? 0.5 : 0.7);

      const p = (t * spec.rate + b.phase) % 1;
      const newStroke = p < b.lastPhase;
      b.lastPhase = p;
      if (b.kind === "eight" || b.kind === "four" || b.kind === "single") {
        const st = stroke(p);
        const seats = spec.seats;
        const spacing = spec.length / (seats + 2.2);
        for (let i = 0; i < seats; i++) {
          const zSeat = (i - (seats - 1) / 2) * spacing - 0.2;
          const zBody = zSeat + st.slide * 0.5;
          put(bodies, nb++, part(0, 0.05 * T, zBody, 0, 0, 0, T, T, T), b.crew[i]);
          put(heads, nhd++, part(0, 0.75 * T, zBody - 0.04, 0, 0, 0, T, T, T), b.skin[i]);
          const sides = spec.sweep ? [i % 2 === 0 ? 1 : -1] : [1, -1];
          const len = spec.sweep ? 3.75 : 2.9;
          const spread = spec.sweep ? 0.85 : 0.8;
          for (const s of sides) {
            const bladeY = 0.4 * st.lift;
            const tilt = Math.atan2(0.35 - bladeY, len - spread);
            const yawO = s > 0 ? -st.angle : Math.PI + st.angle;
            put(oars, no++, part(s * spread * T, 0.35 * T, zSeat + 0.1, 0, yawO, -tilt, len, T, T), b.blade);
            if (newStroke && !runtime.reducedMotion) {
              // The puddle a blade leaves at the finish.
              const ang = -0.62;
              spawnRing(s * (spread * T + Math.cos(ang) * len), zSeat + Math.sin(ang) * len, 1.6 * T);
            }
          }
        }
        if (b.kind === "eight") {
          // The coxswain in the stern, facing forward.
          put(bodies, nb++, part(0, 0.0, -spec.length * 0.42, 0, 0, 0, 0.9 * T, 0.85 * T, 0.9 * T), b.crew[seats]);
          put(heads, nhd++, part(0, 0.62 * T, -spec.length * 0.42, 0, 0, 0, T, T, T), b.skin[seats]);
        }
      } else if (b.kind === "sup") {
        // Standing paddler, switching sides every few strokes.
        if (newStroke && ++b.strokes % 5 === 0) b.side *= -1;
        const bob = Math.sin(t * 2.1 + b.phase * 6) * 0.03;
        put(standing, ns++, part(0, (0.1 + bob) * T, 0, 0, 0, 0, T, T, T), b.crew[0]);
        put(heads, nhd++, part(0, (1.62 + bob) * T, 0, 0, 0, 0, T, T, T), b.skin[0]);
        const sw = Math.sin(p * Math.PI * 2);
        put(oars, no++, part(b.side * 0.34 * T, 1.35 * T, 0.1 + sw * 0.35, 0, 0, -Math.PI / 2 - 0.12 * b.side, 1.9 * T, T, 1.4 * T), b.blade);
        if (newStroke && !runtime.reducedMotion) spawnRing(b.side * 0.45 * T, -0.3, 1.1 * T);
      } else if (b.kind === "kayak") {
        put(bodies, nb++, part(0, 0.12 * T, 0, 0, 0, 0, T, 0.9 * T, T), b.crew[0]);
        put(heads, nhd++, part(0, 0.72 * T, 0, 0, 0, 0, T, T, T), b.skin[0]);
        // Double-bladed paddle as two rigid halves, rocking side to side.
        const roll = Math.sin(p * Math.PI * 2) * 0.45;
        const yawK = Math.cos(p * Math.PI * 2) * 0.35;
        put(oars, no++, part(0, 0.55 * T, 0.1, 0, -yawK, -roll, 1.15 * T, T, 1.1 * T), b.blade);
        put(oars, no++, part(0, 0.55 * T, 0.1, 0, Math.PI - yawK, roll, 1.15 * T, T, 1.1 * T), b.blade);
        if (newStroke && !runtime.reducedMotion) spawnRing(0.95 * T, -0.4, 1.0 * T);
      } else if (b.kind === "canoe") {
        const sw = Math.sin(p * Math.PI * 2);
        for (let i = 0; i < 2; i++) {
          const zc = i === 0 ? 1.4 : -1.4;
          const s = i === 0 ? 1 : -1;
          put(bodies, nb++, part(0, 0.15 * T, zc, 0, 0, 0, T, 0.9 * T, T), b.crew[i]);
          put(heads, nhd++, part(0, 0.75 * T, zc, 0, 0, 0, T, T, T), b.skin[i]);
          put(oars, no++, part(s * 0.45 * T, 0.8 * T, zc + sw * 0.3, 0, 0, -Math.PI / 2 - 0.2 * s, 1.4 * T, T, 1.3 * T), b.blade);
        }
      } else if (b.kind === "pontoon") {
        // Canopy over the deck, a boatload of bat watchers.
        put(canopies, nc++, part(0, 2.1, 0, 0, 0, 0, spec.width * 0.95, 0.15, spec.length * 0.8), b.blade);
        for (let i = 0; i < spec.seats; i++) {
          const row = Math.floor(i / 2);
          const zc = (row - 1.5) * 1.7;
          const xc = i % 2 === 0 ? -0.7 : 0.7;
          put(bodies, nb++, part(xc, 0.25, zc, 0, 0, 0, 1, 1, 1), b.crew[i % b.crew.length]);
          put(heads, nhd++, part(xc, 0.95, zc, 0, 0, 0, 1, 1, 1), b.skin[i % b.skin.length]);
        }
      }
    }

    // The riverboat.
    const rbShow = inWindow(tod, [0.26, 0.8]);
    riverboat.visible = !!riverboatPath && rbShow > 0.5;
    if (riverboatPath && riverboat.visible) {
      const d = t * 0.004;
      riverboatPath.at(d, probe);
      const k = Math.min(E, 2.2) * 0.001;
      riverboat.position.set(probe.x, groundY(ground, probe.x, probe.z) + 0.00002, probe.z);
      riverboat.rotation.set(0, Math.atan2(probe.dx, probe.dz), 0);
      riverboat.scale.setScalar(k);
      wheel.rotation.x = -t * 2.2;
      tmpBoat.compose(riverboat.position, riverboat.quaternion, s3.setScalar(k));
      tmpLocal.compose(v3.set(0, 0.03, -9.5), q.identity(), s3.set(40, 1, 70));
      wakes.setMatrixAt(nw, tmpOut.multiplyMatrices(tmpBoat, tmpLocal));
      wakeFade.setX(nw++, 1);
    }

    // Age the rings.
    for (let i = 0; i < MAX_RINGS; i++) {
      const f = ringFade.getX(i);
      if (f > 0) ringFade.setX(i, Math.max(0, f - dt / 4));
    }

    hulls.count = nh;
    bodies.count = nb;
    standing.count = ns;
    heads.count = nhd;
    oars.count = no;
    wakes.count = nw;
    canopies.count = nc;
    rings.count = MAX_RINGS;
    for (const m of [hulls, bodies, standing, heads, oars, wakes, canopies, rings]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    wakeFade.needsUpdate = true;
    ringFade.needsUpdate = true;
  });

  return <primitive ref={ref} object={root} />;
}
