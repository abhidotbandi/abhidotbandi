"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Polyline } from "@/lib/atlas/assets";
import { sampleWaterKm, type Central } from "@/lib/atlas/central";
import { BUILDING_EXAG, groundY, project, type HeightField } from "@/lib/atlas/geo";
import { Path } from "@/lib/atlas/paths";
import { runtime } from "@/lib/atlas/store";
import { sky } from "@/lib/atlas/timeOfDay";
import { SHIRTS, SKIN, figureScale, headGeo, inWindow, instanced, pick, standGeo } from "./figures";
import { radialTexture } from "./glow";

// Crowds in the streets: Rainey Street's bungalow bars under string lights and East 6th under
// neon at night, shoppers on South Congress by day, the crowd on the Congress Avenue Bridge
// waiting for the bats at dusk, and the sunset crowd on Mount Bonnell.

const M = 0.001;
const V = M * BUILDING_EXAG;

type Scene = "rainey" | "sixth" | "soco" | "bats" | "bonnell";

/** When each crowd is out (time of day, 0 dawn .. 1 night). */
const WINDOWS: Record<Scene, [number, number]> = {
  rainey: [0.83, 1.2],
  sixth: [0.86, 1.2],
  soco: [0.26, 0.9],
  bats: [0.79, 0.95],
  bonnell: [0.7, 0.9],
};

const NEON = ["#ff4fa3", "#4fd6ff", "#ff5a3c", "#b36bff", "#57ff8a", "#ffd84f", "#ff7b2e"].map((c) => new THREE.Color(c));
const BULB = new THREE.Color("#ffc873");

interface Stander {
  scene: Scene;
  x: number;
  z: number;
  yaw: number;
  shirt: THREE.Color;
  skin: THREE.Color;
  phase: number;
}

interface Walker {
  scene: Scene;
  path: Path;
  d: number;
  dir: number;
  lateral: number; // km
  speed: number; // km/s
  shirt: THREE.Color;
  skin: THREE.Color;
  phase: number;
}

interface Sim {
  standers: Stander[];
  walkers: Walker[];
  bodies: THREE.InstancedMesh;
  heads: THREE.InstancedMesh;
  bulbs: THREE.Points;
  neon: THREE.Points;
}

/** Points along a polyline every `step` km, with the unit direction there. */
function along(l: Polyline, step: number): { x: number; z: number; dx: number; dz: number }[] {
  const p = new Path(l);
  const out: { x: number; z: number; dx: number; dz: number }[] = [];
  for (let d = step / 2; d < p.length; d += step) {
    const o = { x: 0, z: 0, dx: 0, dz: 0 };
    p.at(d, o);
    out.push(o);
  }
  return out;
}

function glowSprite(): THREE.Texture {
  return radialTexture(32, [
    [0, 255, 255, 255, 1],
    [0.35, 255, 255, 255, 0.55],
    [1, 255, 255, 255, 0],
  ]);
}

function points(pos: number[], col: number[], size: number, map: THREE.Texture): THREE.Points {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({
    size: size * Math.min(2, window.devicePixelRatio || 1),
    sizeAttenuation: false,
    vertexColors: true,
    map,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

function makeSim(c: Central, ground: HeightField, lowPower: boolean): THREE.Group {
  const rnd = Math.random;
  const dense = lowPower ? 0.4 : 1;
  const count = (n: number) => Math.max(1, Math.round(n * dense));
  const shirt = () => new THREE.Color(pick(SHIRTS, rnd()));
  const skin = () => pick(SKIN, rnd()).clone();
  const standers: Stander[] = [];
  const walkers: Walker[] = [];

  // Rainey Street: groups on the sidewalks, porches and patios, and some in the street.
  const rainey = c.streets.rainey;
  const raineyLen = rainey.reduce((s, l) => s + new Path(l).length, 0);
  for (const l of rainey) {
    const path = new Path(l);
    const groups = count((path.length / Math.max(raineyLen, 1e-6)) * 110);
    const o = { x: 0, z: 0, dx: 0, dz: 0 };
    for (let g = 0; g < groups; g++) {
      path.at(rnd() * path.length, o);
      // Mostly on the sidewalks and spilling into the street; some in the bungalows' yards.
      const side = rnd() < 0.5 ? -1 : 1;
      const r = rnd();
      const lat = (r < 0.3 ? rnd() * 3 : r < 0.8 ? 3 + rnd() * 5 : 9 + rnd() * 7) * side * M;
      const cx = o.x - o.dz * lat;
      const cz = o.z + o.dx * lat;
      const n = 2 + Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rnd();
        const r = 0.7 + rnd() * 0.4;
        standers.push({ scene: "rainey", x: cx + Math.cos(a) * r * M, z: cz + Math.sin(a) * r * M, yaw: a + Math.PI / 2 + Math.PI, shirt: shirt(), skin: skin(), phase: rnd() * 10 });
      }
    }
  }

  // East 6th: the street closes to cars and fills with people walking between the bars.
  for (const l of c.streets.sixth) {
    const path = new Path(l);
    const n = count(path.length * 330);
    for (let i = 0; i < n; i++) {
      walkers.push({
        scene: "sixth",
        path,
        d: rnd() * path.length,
        dir: rnd() < 0.5 ? 1 : -1,
        lateral: (rnd() - 0.5) * 22 * M,
        speed: (1 + rnd() * 0.5) * 1.6 * M,
        shirt: shirt(),
        skin: skin(),
        phase: rnd() * 10,
      });
    }
    // And knots of people outside the doors.
    for (const p of along(l, 0.012)) {
      if (rnd() < 0.4 * dense) continue;
      const side = rnd() < 0.5 ? -1 : 1;
      const lat = side * (8 + rnd() * 3) * M;
      for (let k = 0; k < 2 + Math.floor(rnd() * 3); k++) {
        standers.push({
          scene: "sixth",
          x: p.x - p.dz * lat + (rnd() - 0.5) * 2 * M,
          z: p.z + p.dx * lat + (rnd() - 0.5) * 2 * M,
          yaw: rnd() * Math.PI * 2,
          shirt: shirt(),
          skin: skin(),
          phase: rnd() * 10,
        });
      }
    }
  }

  // South Congress: shoppers along the sidewalks.
  for (const l of c.streets.soco) {
    const path = new Path(l);
    const n = count(path.length * 110);
    for (let i = 0; i < n; i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      walkers.push({
        scene: "soco",
        path,
        d: rnd() * path.length,
        dir: rnd() < 0.5 ? 1 : -1,
        lateral: side * (13 + rnd() * 3) * M,
        speed: (0.9 + rnd() * 0.4) * 1.6 * M,
        shirt: shirt(),
        skin: skin(),
        phase: rnd() * 10,
      });
    }
  }

  // The Congress Avenue Bridge at dusk: watchers along both railings, most on the east side
  // where the bats stream out, and a crowd on the lawn by the south-east abutment.
  const bridge = c.bridges.find((b) => b.name === "South Congress Avenue");
  if (bridge) {
    const path = new Path(bridge.line);
    const o = { x: 0, z: 0, dx: 0, dz: 0 };
    const n = count(150);
    for (let i = 0; i < n; i++) {
      const d = 0.03 + rnd() * (path.length - 0.06);
      path.at(d, o);
      // Heading north to south: +90 degrees of travel is the west side.
      const east = rnd() < 0.72;
      const east0 = { x: o.dz, z: -o.dx }; // left of travel: travel runs north to south, so left is east
      const s = east ? 1 : -1;
      const lat = (10.2 + rnd() * 0.8) * M;
      standers.push({
        scene: "bats",
        x: o.x + east0.x * s * lat,
        z: o.z + east0.z * s * lat,
        yaw: Math.atan2(east0.x * s, east0.z * s),
        shirt: shirt(),
        skin: skin(),
        phase: rnd() * 10,
      });
    }
    const L = bridge.line.length / 2;
    const bx = bridge.line[L * 2 - 2];
    const bz = bridge.line[L * 2 - 1];
    let placed = 0;
    for (let t = 0; t < 900 && placed < count(80); t++) {
      const x = bx + (0.02 + rnd() * 0.07);
      const z = bz - rnd() * 0.05;
      if (sampleWaterKm(c, x, z) > -0.006) continue;
      standers.push({ scene: "bats", x, z, yaw: Math.atan2(-0.3, -1), shirt: shirt(), skin: skin(), phase: rnd() * 10 });
      placed++;
    }
  }

  // Mount Bonnell at sunset: people along the summit facing west over Lake Austin.
  {
    const [bx, bz] = project(-97.77325, 30.32161);
    for (let i = 0; i < count(34); i++) {
      // West and north-west of the pavilion, along the edge above the lake.
      const a = Math.PI - 0.4 + (rnd() - 0.5) * 1.6;
      const r = (6 + rnd() * 14) * M;
      standers.push({ scene: "bonnell", x: bx + Math.cos(a) * r, z: bz + Math.sin(a) * r, yaw: -Math.PI / 2 - 0.3 + (rnd() - 0.5) * 0.8, shirt: shirt(), skin: skin(), phase: rnd() * 10 });
    }
  }

  // String lights over Rainey (across the street and along the patios) and neon on 6th.
  const map = glowSprite();
  const bpos: number[] = [];
  const bcol: number[] = [];
  const bulb = (x: number, y: number, z: number, k = 1) => {
    bpos.push(x, y, z);
    bcol.push(BULB.r * k, BULB.g * k, BULB.b * k);
  };
  for (const l of rainey) {
    const pts = along(l, 0.011);
    pts.forEach((p, i) => {
      const y0 = groundY(ground, p.x, p.z);
      // A zig-zag of catenaries across the street.
      const shift = (i % 2 ? 1 : -1) * 3 * M;
      for (let j = 0; j <= 10; j++) {
        const u = j / 10;
        const lat = (-8 + 16 * u) * M;
        const y = y0 + (5.2 - 1.3 * Math.sin(Math.PI * u)) * V;
        bulb(p.x - p.dz * lat + p.dx * shift * (2 * u - 1), y, p.z + p.dx * lat + p.dz * shift * (2 * u - 1));
      }
      // Patio strings along each side.
      for (const side of [-1, 1]) {
        const lat = side * (15 + (i % 3)) * M;
        for (let j = 0; j < 5; j++) {
          const u = j / 5;
          const s = (u - 0.5) * 11 * M;
          bulb(p.x - p.dz * lat + p.dx * s, y0 + (3.4 - 0.7 * Math.sin(Math.PI * u)) * V, p.z + p.dx * lat + p.dz * s, 0.9);
        }
      }
    });
  }
  const npos: number[] = [];
  const ncol: number[] = [];
  for (const l of c.streets.sixth) {
    along(l, 0.009).forEach((p, i) => {
      const y0 = groundY(ground, p.x, p.z);
      for (const side of [-1, 1]) {
        if (rnd() < 0.25) continue;
        const lat = side * (11.5 + rnd()) * M;
        const col = NEON[(i * 3 + (side > 0 ? 1 : 0) + Math.floor(rnd() * 3)) % NEON.length];
        const h = 4 + rnd() * 4;
        for (let k = 0; k < 2; k++) {
          npos.push(p.x - p.dz * lat + p.dx * (k - 0.5) * 2.2 * M, y0 + (h + k * 0.9) * V, p.z + p.dx * lat + p.dz * (k - 0.5) * 2.2 * M);
          ncol.push(col.r, col.g, col.b);
        }
      }
    });
  }

  const mat = new THREE.MeshLambertMaterial({ color: "#ffffff" });
  const total = standers.length + walkers.length;
  const sim: Sim = {
    standers,
    walkers,
    bodies: instanced(standGeo(), mat, total),
    heads: instanced(headGeo(), mat, total),
    bulbs: points(bpos, bcol, 4, map),
    neon: points(npos, ncol, 8, map),
  };
  const root = new THREE.Group();
  root.add(sim.bodies, sim.heads, sim.bulbs, sim.neon);
  root.userData.sim = sim;
  return root;
}

const q = new THREE.Quaternion();
const e3 = new THREE.Euler();
const v3 = new THREE.Vector3();
const s3 = new THREE.Vector3();
const mOut = new THREE.Matrix4();
const probe = { x: 0, z: 0, dx: 0, dz: 0 };

function placeAt(x: number, y: number, z: number, yaw: number, k: number, lean = 0): THREE.Matrix4 {
  e3.set(lean, yaw, 0, "YXZ");
  q.setFromEuler(e3);
  return mOut.compose(v3.set(x, y, z), q, s3.set(k, k, k));
}

export default function CityLife({ central, ground, lowPower }: { central: Central; ground: HeightField; lowPower: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const root = useMemo(() => makeSim(central, ground, lowPower), [central, ground, lowPower]);

  useFrame((state, rawDt) => {
    const g = ref.current;
    if (!g) return;
    const cam = runtime.cam;
    const near = cam.dist < 7 && Math.hypot(cam.x + 0.8, cam.z + 1) < 9;
    g.visible = near;
    if (!near) return;
    const sim = g.userData.sim as Sim;
    const still = runtime.reducedMotion;
    const dt = still ? 0 : Math.min(rawDt, 0.1);
    const t = still ? 0 : state.clock.elapsedTime;
    const tod = runtime.tod;
    const E = figureScale(cam.dist);
    const on: Record<Scene, number> = {
      rainey: inWindow(tod, WINDOWS.rainey),
      sixth: inWindow(tod, WINDOWS.sixth),
      soco: inWindow(tod, WINDOWS.soco),
      bats: inWindow(tod, WINDOWS.bats),
      bonnell: inWindow(tod, WINDOWS.bonnell),
    };
    const { bodies, heads } = sim;
    let n = 0;
    const put = (x: number, y: number, z: number, yaw: number, k: number, lean: number, shirt: THREE.Color, skin: THREE.Color) => {
      bodies.setMatrixAt(n, placeAt(x, y, z, yaw, k, lean));
      bodies.setColorAt(n, shirt);
      heads.setMatrixAt(n, placeAt(x + Math.sin(yaw) * lean * 1.5 * k, y + 1.62 * k, z + Math.cos(yaw) * lean * 1.5 * k, yaw, k));
      heads.setColorAt(n, skin);
      n++;
    };
    const reach = Math.max(1.5, cam.dist * 2.6);

    for (const p of sim.standers) {
      const w = on[p.scene];
      if (w < 0.1 || Math.abs(p.x - cam.x) > reach || Math.abs(p.z - cam.z) > reach) continue;
      const k = E * M * w;
      const sway = Math.sin(t * 1.3 + p.phase) * 0.04;
      put(p.x, groundY(ground, p.x, p.z), p.z, p.yaw + sway, k, 0.02, p.shirt, p.skin);
    }
    for (const wk of sim.walkers) {
      const w = on[wk.scene];
      if (w < 0.1) continue;
      const L = wk.path.length;
      wk.d += wk.speed * dt * wk.dir;
      if (wk.d > L) {
        wk.d = L;
        wk.dir = -1;
      } else if (wk.d < 0) {
        wk.d = 0;
        wk.dir = 1;
      }
      wk.path.at(wk.d, probe);
      const x = probe.x - probe.dz * wk.lateral;
      const z = probe.z + probe.dx * wk.lateral;
      if (Math.abs(x - cam.x) > reach || Math.abs(z - cam.z) > reach) continue;
      const k = E * M * w;
      const bob = Math.abs(Math.sin((t * 1.9 + wk.phase) * Math.PI)) * 0.03;
      put(x, groundY(ground, x, z) + bob * k, z, Math.atan2(probe.dx * wk.dir, probe.dz * wk.dir), k, 0.04, wk.shirt, wk.skin);
    }
    for (const m of [bodies, heads]) {
      m.count = n;
      if (n === 0) continue;
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(0, n * 16);
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) {
        m.instanceColor.clearUpdateRanges();
        m.instanceColor.addUpdateRange(0, n * 3);
        m.instanceColor.needsUpdate = true;
      }
    }

    // Lights come up after dark and fade as the view pulls out over the whole city.
    const night = sky.uNight.value;
    const fade = THREE.MathUtils.clamp((6 - cam.dist) / 3, 0, 1);
    const bm = sim.bulbs.material as THREE.PointsMaterial;
    bm.opacity = Math.min(1, night * 1.4) * fade * Math.max(on.rainey, 0.35);
    sim.bulbs.visible = bm.opacity > 0.02;
    const nm = sim.neon.material as THREE.PointsMaterial;
    nm.opacity = Math.min(1, night * 1.4) * fade;
    sim.neon.visible = nm.opacity > 0.02;
  });

  return <primitive ref={ref} object={root} />;
}
