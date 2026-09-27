"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import earcut from "earcut";
import type { Polyline } from "@/lib/atlas/assets";
import { sampleCanopy, sampleWaterKm, type Central } from "@/lib/atlas/central";
import { groundY, type HeightField } from "@/lib/atlas/geo";
import { Path } from "@/lib/atlas/paths";
import { pointInPoly } from "@/lib/atlas/polygon";
import { runtime } from "@/lib/atlas/store";
import { sky } from "@/lib/atlas/timeOfDay";
import {
  SHIRTS,
  SKIN,
  box,
  figureScale,
  headGeo,
  inWindow,
  instanced,
  lyingGeo,
  merge,
  pick,
  standGeo,
} from "./figures";

// People on land: walkers, runners and cyclists on the Butler Hike-and-Bike Trail; swimmers
// and sunbathers at Barton Springs and Deep Eddy; picnics under canopy tents, kites, frisbees
// and dogs on Zilker's Great Lawn; and the Zilker Eagle mini train on its track through the park.

const M = 0.001;

// ---------------------------------------------------------------- geometry helpers

/** Merge parts, each with a grey level the instance colour multiplies (trim, legs, shading). */
function shaded(parts: [THREE.BufferGeometry, number][]): THREE.BufferGeometry {
  const g = merge(parts.map(([p]) => p));
  const col: number[] = [];
  for (const [p, k] of parts) {
    const n = p.index ? p.index.count : p.attributes.position.count;
    for (let i = 0; i < n; i++) col.push(k, k, k);
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** A ring without its closing duplicate vertex. */
function ring(poly: Polyline): Float32Array {
  const n = poly.length / 2;
  const closed = n > 3 && poly[0] === poly[n * 2 - 2] && poly[1] === poly[n * 2 - 1];
  return closed ? poly.subarray(0, n * 2 - 2) : poly;
}

/** Centroid and principal axes of a polygon's vertices, with extents along them. */
function axes(poly: Polyline) {
  const n = poly.length / 2;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    cx += poly[i * 2];
    cz += poly[i * 2 + 1];
  }
  cx /= n;
  cz /= n;
  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  for (let i = 0; i < n; i++) {
    const dx = poly[i * 2] - cx;
    const dz = poly[i * 2 + 1] - cz;
    sxx += dx * dx;
    szz += dz * dz;
    sxz += dx * dz;
  }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ux = Math.cos(ang);
  const uz = Math.sin(ang);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const dx = poly[i * 2] - cx;
    const dz = poly[i * 2 + 1] - cz;
    const u = dx * ux + dz * uz;
    const v = -dx * uz + dz * ux;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  return { cx, cz, ux, uz, u0, u1, v0, v1 };
}

function bbox(poly: Polyline) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    x0 = Math.min(x0, poly[i]);
    x1 = Math.max(x1, poly[i]);
    z0 = Math.min(z0, poly[i + 1]);
    z1 = Math.max(z1, poly[i + 1]);
  }
  return { x0, x1, z0, z1 };
}

function edgeDist(r: Float32Array, x: number, z: number): number {
  const n = r.length / 2;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r[i * 2];
    const az = r[i * 2 + 1];
    const dx = r[j * 2] - ax;
    const dz = r[j * 2 + 1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/** The water surface of a pool: high enough to clear the mesh over the whole pool interior. */
function poolLevel(r: Float32Array, ground: HeightField): number {
  const bb = bbox(r);
  const hs: number[] = [];
  for (let x = bb.x0; x <= bb.x1; x += 0.003) {
    for (let z = bb.z0; z <= bb.z1; z += 0.003) {
      if (pointInPoly(r, x, z) && edgeDist(r, x, z) > 0.006) hs.push(groundY(ground, x, z));
    }
  }
  if (!hs.length) {
    const ax = axes(r);
    return groundY(ground, ax.cx, ax.cz) + 0.0004;
  }
  hs.sort((a, b) => a - b);
  return hs[Math.floor((hs.length - 1) * 0.9)] + 0.0003;
}

// ---------------------------------------------------------------- the pools

const POOL_VERT = /* glsl */ `
  varying vec2 vM;
  void main() {
    vM = position.xz * 1000.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Spring water: clear and green-blue over a pale limestone bottom, with drifting caustics.
const POOL_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uNight;
  varying vec2 vM;
  float caustic(vec2 p, float t) {
    float c = sin(p.x * 0.83 + t * 0.9) + sin(p.y * 0.71 - t * 0.7) + sin((p.x + p.y) * 0.57 + t * 1.3)
            + sin((p.x - p.y) * 1.13 - t * 0.5);
    return pow(0.5 + 0.5 * sin(c * 1.7), 8.0);
  }
  void main() {
    float t = uTime;
    float c = caustic(vM, t) * 0.6 + caustic(vM * 1.9 + 7.0, t * 1.3) * 0.4;
    vec3 col = mix(vec3(0.16, 0.58, 0.56), vec3(0.42, 0.8, 0.74), 0.45 + 0.2 * sin(vM.x * 0.05 + vM.y * 0.03));
    col += c * vec3(0.22, 0.24, 0.2);
    col *= mix(1.0, 0.22, uNight);
    gl_FragColor = vec4(col, 0.86);
  }
`;

/** A spring-water overlay on each pool, with a pale concrete rim. */
function poolMeshes(pools: { poly: Polyline; level: number }[]): THREE.Group {
  const water: number[] = [];
  const rim: number[] = [];
  for (const { poly, level: y } of pools) {
    const r = ring(poly);
    const n = r.length / 2;
    if (n < 3) continue;
    const flat = Array.from(r);
    const idx = earcut(flat);
    for (let k = 0; k < idx.length; k += 3) {
      for (const j of [0, 2, 1]) water.push(flat[idx[k + j] * 2], y, flat[idx[k + j] * 2 + 1]);
    }
    // Rim: a 1.6 m strip centred on the outline, mitred at the corners.
    const half = 0.8 * M;
    const off: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = (i + n - 1) % n;
      const q = (i + 1) % n;
      let ax1 = r[i * 2] - r[p * 2];
      let az1 = r[i * 2 + 1] - r[p * 2 + 1];
      let ax2 = r[q * 2] - r[i * 2];
      let az2 = r[q * 2 + 1] - r[i * 2 + 1];
      const l1 = Math.hypot(ax1, az1) || 1;
      const l2 = Math.hypot(ax2, az2) || 1;
      ax1 /= l1;
      az1 /= l1;
      ax2 /= l2;
      az2 /= l2;
      let nx = -(az1 + az2);
      let nz = ax1 + ax2;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl;
      nz /= nl;
      const miter = Math.min(2.5, 1 / Math.max(0.2, nx * -az2 + nz * ax2));
      off.push(nx * half * miter, nz * half * miter);
    }
    const yr = y + 0.0002;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = [r[i * 2] - off[i * 2], yr, r[i * 2 + 1] - off[i * 2 + 1]];
      const b = [r[i * 2] + off[i * 2], yr, r[i * 2 + 1] + off[i * 2 + 1]];
      const c = [r[j * 2] + off[j * 2], yr, r[j * 2 + 1] + off[j * 2 + 1]];
      const d = [r[j * 2] - off[j * 2], yr, r[j * 2 + 1] - off[j * 2 + 1]];
      rim.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute("position", new THREE.Float32BufferAttribute(water, 3));
  const wm = new THREE.ShaderMaterial({
    vertexShader: POOL_VERT,
    fragmentShader: POOL_FRAG,
    uniforms: { uTime: sky.uTime, uNight: sky.uNight },
    transparent: true,
    depthWrite: false,
  });
  const rg = new THREE.BufferGeometry();
  rg.setAttribute("position", new THREE.Float32BufferAttribute(rim, 3));
  rg.computeVertexNormals();
  const rm = new THREE.MeshLambertMaterial({ color: "#e6e0d4", side: THREE.DoubleSide });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(wg, wm), new THREE.Mesh(rg, rm));
  return group;
}

// ---------------------------------------------------------------- the cast

interface Walker {
  kind: "walk" | "run" | "bike";
  edge: number;
  dir: number;
  d: number;
  speed: number; // km/s
  lateral: number; // km, to the right of travel
  window: [number, number];
  show: number;
  shirt: THREE.Color;
  skin: THREE.Color;
  dog: THREE.Color | null;
  phase: number;
}

interface Swimmer {
  pool: number;
  u: number; // km along the pool's long axis
  v: number; // across it
  dir: number;
  speed: number; // 0: wading or treading water
  skin: THREE.Color;
  suit: THREE.Color;
  phase: number;
}

interface Person {
  dx: number; // m, in the group's frame
  dz: number;
  yaw: number;
  shirt: THREE.Color;
  skin: THREE.Color;
}

interface Placed {
  x: number;
  z: number;
  yaw: number;
  a: THREE.Color; // towel, blanket, tent roof
  people: Person[];
  tent: boolean;
}

interface Kite {
  fx: number;
  fz: number;
  color: THREE.Color;
  shirt: THREE.Color;
  skin: THREE.Color;
  reach: number; // m downwind
  height: number; // m
  phase: number;
}

interface Pair {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  shirts: [THREE.Color, THREE.Color];
  skins: [THREE.Color, THREE.Color];
  phase: number;
}

interface Roamer {
  x: number;
  z: number;
  hx: number;
  hz: number;
  speed: number; // km/s
  color: THREE.Color;
  skin: THREE.Color | null; // people have skin; dogs don't
  phase: number;
}

interface Edge {
  path: Path;
  a: number;
  b: number;
  kind: number;
  y0: number;
  y1: number;
  rise: number;
}

interface Sim {
  central: Central;
  edges: Edge[];
  adj: number[][];
  walkers: Walker[];
  pools: { poly: Polyline; ax: ReturnType<typeof axes>; level: number }[];
  swimmers: Swimmer[];
  sunbathers: Placed[];
  groups: Placed[];
  kites: Kite[];
  pairs: Pair[];
  roamers: Roamer[];
  lawn: Polyline | null;
  train: { path: Path; closed: boolean; d: number; dir: number } | null;
  meshes: Meshes;
  lines: THREE.LineSegments;
}

interface Meshes {
  standing: THREE.InstancedMesh;
  seated: THREE.InstancedMesh;
  riders: THREE.InstancedMesh;
  lying: THREE.InstancedMesh;
  heads: THREE.InstancedMesh;
  bikes: THREE.InstancedMesh;
  flats: THREE.InstancedMesh; // towels, blankets
  tents: THREE.InstancedMesh;
  kites: THREE.InstancedMesh;
  discs: THREE.InstancedMesh;
  dogs: THREE.InstancedMesh;
  cars: THREE.InstancedMesh;
}

const TOWELS = ["#e8c34a", "#3fb7b0", "#f07a5a", "#f4f1ea", "#2f6fb0", "#c8352e", "#8cc63f", "#f2a0b5"];
const TENTS = ["#f4f1ea", "#2f6fb0", "#c8352e", "#e8c34a", "#3a8f5c", "#f28c28", "#f4f1ea", "#1d2b4f"];
const KITES = ["#d9412f", "#f2c230", "#2f6fb0", "#8cc63f", "#f07a5a", "#7b4fb8", "#f28c28", "#3fb7b0"];
const DOGS = ["#8a6a4a", "#2b2522", "#d8c7a8", "#b58a5a", "#f1e6d0"];
const RUN_SHIRTS = ["#f28c28", "#3fb7b0", "#e8c34a", "#c8352e", "#f4f1ea", "#7b4fb8", "#8cc63f"];

const WIND = { x: -0.6, z: -0.8 }; // south-easterly: kites stream to the north-west

function makeSim(c: Central, ground: HeightField, lowPower: boolean): THREE.Group {
  const rnd = Math.random;
  const col = (hex: string) => new THREE.Color(hex);
  const shirt = () => col(pick(SHIRTS, rnd()));
  const skin = () => pick(SKIN, rnd()).clone();
  const dense = lowPower ? 0.4 : 1;
  const count = (n: number) => Math.max(1, Math.round(n * dense));

  // The trail graph.
  const nodes = c.trails.nodes;
  const adj: number[][] = Array.from({ length: nodes.length / 2 }, () => []);
  const edges: Edge[] = c.trails.edges.map((e, i) => {
    adj[e.a].push(i);
    adj[e.b].push(i);
    const line = e.line;
    const n = line.length / 2;
    const y0 = groundY(ground, line[0], line[1]);
    const y1 = groundY(ground, line[n * 2 - 2], line[n * 2 - 1]);
    return { path: new Path(line), a: e.a, b: e.b, kind: e.kind, y0, y1, rise: Math.min(0.004, e.length * 0.012) };
  });
  // Start people on the trail itself; the bridge sidewalks carry them across the lake.
  const weight = (e: Edge) => e.path.length * (e.kind === 2 ? 0.2 : 1);
  const totalW = edges.reduce((s, e) => s + weight(e), 0);
  const walkers: Walker[] = [];
  const nWalk = count(700);
  for (let i = 0; i < nWalk; i++) {
    let r = rnd() * totalW;
    let k = 0;
    while (k < edges.length - 1 && r > weight(edges[k])) r -= weight(edges[k++]);
    const kind: Walker["kind"] = i % 5 === 0 ? "bike" : i % 5 < 3 ? "run" : "walk";
    const speed = (kind === "walk" ? 1.4 : kind === "run" ? 3.1 : 5.5) * 2 * (0.85 + rnd() * 0.3) * M;
    const morning = rnd() < 0.55;
    walkers.push({
      kind,
      edge: k,
      dir: rnd() < 0.5 ? 1 : -1,
      d: rnd() * edges[k].path.length,
      speed,
      lateral: (kind === "bike" ? 1.1 : 0.5 + rnd() * 0.9) * M,
      // Runners own the trail at dawn and sunset; walkers and cyclists fill the day.
      window:
        kind === "walk"
          ? [0.1 + rnd() * 0.12, 0.82 + rnd() * 0.1]
          : kind === "run"
            ? morning
              ? [0.03 + rnd() * 0.07, 0.34 + rnd() * 0.16]
              : [0.52 + rnd() * 0.16, 0.88 + rnd() * 0.07]
            : [0.12 + rnd() * 0.1, 0.8 + rnd() * 0.1],
      show: 0,
      shirt: kind === "run" ? col(pick(RUN_SHIRTS, rnd())) : shirt(),
      skin: skin(),
      dog: kind === "walk" && rnd() < 0.35 ? col(pick(DOGS, rnd())) : null,
      phase: rnd(),
    });
  }

  // Pools: Deep Eddy and Barton Springs, the long spring-fed pool.
  const pools = c.pools.map((poly) => ({ poly, ax: axes(ring(poly)), level: poolLevel(ring(poly), ground) }));
  const swimmers: Swimmer[] = [];
  pools.forEach((p, pi) => {
    const length = p.ax.u1 - p.ax.u0;
    const width = p.ax.v1 - p.ax.v0;
    const n = count(Math.min(90, (length * width) / 0.00022));
    let tries = 0;
    while (swimmers.filter((s) => s.pool === pi).length < n && tries++ < n * 20) {
      const u = p.ax.u0 + rnd() * length;
      const v = p.ax.v0 + (0.12 + rnd() * 0.76) * width;
      if (!pointInPoly(p.poly, p.ax.cx + u * p.ax.ux - v * p.ax.uz, p.ax.cz + u * p.ax.uz + v * p.ax.ux)) continue;
      const laps = rnd() < 0.55;
      swimmers.push({
        pool: pi,
        u,
        v,
        dir: rnd() < 0.5 ? 1 : -1,
        speed: laps ? (0.8 + rnd() * 0.5) * 1.5 * M : 0,
        skin: skin(),
        suit: col(pick(["#1d2b4f", "#c8352e", "#20242b", "#2f6fb0", "#3a8f5c", "#e8c34a"], rnd())),
        phase: rnd() * 10,
      });
    }
  });

  // Sunbathers on the grass around Barton Springs, mostly the south hillside.
  const sunbathers: Placed[] = [];
  const barton = pools.reduce<(typeof pools)[number] | null>(
    (best, p) => (!best || p.ax.u1 - p.ax.u0 > best.ax.u1 - best.ax.u0 ? p : best),
    null,
  );
  const bathhouse = c.landmarks["barton-springs"]?.outline;
  if (barton) {
    const { poly, ax } = barton;
    let tries = 0;
    const want = count(120);
    while (sunbathers.length < want && tries++ < 6000) {
      const u = ax.u0 - 0.01 + rnd() * (ax.u1 - ax.u0 + 0.02);
      const south = rnd() < 0.65;
      const off = (5 + rnd() * rnd() * 45) * M;
      const v = south ? ax.v1 + off : ax.v0 - off;
      const x = ax.cx + u * ax.ux - v * ax.uz;
      const z = ax.cz + u * ax.uz + v * ax.ux;
      // The south hillside is shaded by big pecans; people lie out under and between them.
      if (pointInPoly(poly, x, z) || sampleWaterKm(c, x, z) > -0.004 || (!south && sampleCanopy(c, x, z) > 0.8)) continue;
      if (bathhouse && (pointInPoly(bathhouse, x, z) || edgeDist(bathhouse, x, z) < 0.005)) continue;
      // Towels are drawn larger than life from afar, so leave room between them.
      if (sunbathers.some((o) => Math.hypot(o.x - x, o.z - z) < 0.0045)) continue;
      const two = rnd() < 0.3;
      const yaw = Math.atan2(ax.ux, ax.uz) + Math.PI / 2 + (rnd() - 0.5) * 0.9 + (rnd() < 0.5 ? 0 : Math.PI);
      const person = () => ({
        dx: 0,
        dz: 0,
        yaw: 0,
        shirt: col(pick(["#c8352e", "#1d2b4f", "#e8c34a", "#20242b", "#f07a5a", "#2f6fb0"], rnd())),
        skin: skin(),
      });
      const people = [person()];
      if (two) people.push({ ...person(), dx: 1.1 });
      sunbathers.push({ x, z, yaw, a: col(pick(TOWELS, rnd())), people, tent: false });
    }
  }

  // Zilker's Great Lawn. Picnics gather along the shady edges; the open middle is for kites,
  // frisbees and dogs.
  const lawn = c.lawns[0] ? ring(c.lawns[0]) : null;
  const onLawn = (shade: boolean): [number, number] | null => {
    if (!lawn) return null;
    const bb = bbox(lawn);
    for (let t = 0; t < 80; t++) {
      const x = bb.x0 + rnd() * (bb.x1 - bb.x0);
      const z = bb.z0 + rnd() * (bb.z1 - bb.z0);
      if (!pointInPoly(lawn, x, z) || sampleCanopy(c, x, z) > 0.3 || sampleWaterKm(c, x, z) > -0.01) continue;
      if (shade) {
        let near = 0;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          near = Math.max(near, sampleCanopy(c, x + Math.cos(a) * 0.022, z + Math.sin(a) * 0.022));
        }
        if (near < 0.35 && rnd() < 0.75) continue;
      }
      return [x, z];
    }
    return null;
  };
  const groups: Placed[] = [];
  const kites: Kite[] = [];
  const pairs: Pair[] = [];
  const roamers: Roamer[] = [];
  if (lawn) {
    for (let i = 0; i < count(70); i++) {
      const p = onLawn(true);
      if (!p) continue;
      const tent = rnd() < 0.3;
      const n = tent ? 3 + Math.floor(rnd() * 4) : 1 + Math.floor(rnd() * 3);
      const people: Person[] = Array.from({ length: n }, (_, k) => {
        const a = (k / n) * Math.PI * 2 + rnd() * 0.4;
        const r = tent ? 1.3 : 0.8;
        return { dx: Math.cos(a) * r, dz: Math.sin(a) * r, yaw: -a - Math.PI / 2, shirt: shirt(), skin: skin() };
      });
      groups.push({ x: p[0], z: p[1], yaw: rnd() * Math.PI, a: col(pick(tent ? TENTS : TOWELS, rnd())), people, tent });
    }
    for (let i = 0; i < count(16); i++) {
      const p = onLawn(false);
      if (!p) continue;
      kites.push({
        fx: p[0],
        fz: p[1],
        color: col(pick(KITES, rnd())),
        shirt: shirt(),
        skin: skin(),
        reach: 20 + rnd() * 20,
        height: 22 + rnd() * 18,
        phase: rnd() * 10,
      });
    }
    for (let i = 0; i < count(12); i++) {
      const p = onLawn(false);
      if (!p) continue;
      const a = rnd() * Math.PI;
      const half = (6 + rnd() * 5) * M;
      pairs.push({
        ax: p[0] - Math.cos(a) * half,
        az: p[1] - Math.sin(a) * half,
        bx: p[0] + Math.cos(a) * half,
        bz: p[1] + Math.sin(a) * half,
        shirts: [shirt(), shirt()],
        skins: [skin(), skin()],
        phase: rnd(),
      });
    }
    for (let i = 0; i < count(46); i++) {
      const p = onLawn(false);
      if (!p) continue;
      const a = rnd() * Math.PI * 2;
      const dog = i % 3 === 0;
      roamers.push({
        x: p[0],
        z: p[1],
        hx: Math.cos(a),
        hz: Math.sin(a),
        speed: (dog ? 3 : 1.3) * (0.8 + rnd() * 0.4) * M,
        color: dog ? col(pick(DOGS, rnd())) : shirt(),
        skin: dog ? null : skin(),
        phase: rnd() * 10,
      });
    }
  }

  // The Zilker Eagle: the longest stretch of its track.
  let train: Sim["train"] = null;
  const longest = c.train.reduce<Polyline | null>((best, l) => (!best || l.length > best.length ? l : best), null);
  if (longest && longest.length >= 4) {
    const n = longest.length / 2;
    const closed = Math.hypot(longest[0] - longest[n * 2 - 2], longest[1] - longest[n * 2 - 1]) < 0.03;
    const path = new Path(longest, closed);
    train = { path, closed, d: path.length * 0.3, dir: 1 };
  }

  // Meshes.
  const mat = new THREE.MeshLambertMaterial({ color: "#ffffff" });
  const trimMat = new THREE.MeshLambertMaterial({ color: "#ffffff", vertexColors: true });
  const kiteMat = new THREE.MeshLambertMaterial({ color: "#ffffff", vertexColors: true, side: THREE.DoubleSide });
  const groupPeople = groups.reduce((s, g) => s + g.people.length, 0);
  const nPeople =
    walkers.length + swimmers.length + sunbathers.length * 2 + groupPeople + kites.length + pairs.length * 2 + roamers.length + 12;
  const bikeGeo = merge([
    box(0.05, 0.66, 0.66, 0, 0.33, 0.52),
    box(0.05, 0.66, 0.66, 0, 0.33, -0.52),
    box(0.06, 0.06, 1.0, 0, 0.62, 0),
  ]);
  // Seated on the grass: torso upright, legs out in front.
  const sitGeo = merge([box(0.42, 0.55, 0.26, 0, 0.36, 0), box(0.34, 0.14, 0.55, 0, 0.07, 0.3)]);
  // A bike rider's torso, origin at the saddle.
  const riderGeo = merge([box(0.4, 0.55, 0.24, 0, 0.3, 0), box(0.28, 0.5, 0.2, 0, -0.2, 0.12)]);
  // Pop-up canopy: a shallow pyramid roof on four legs; the legs stay dark under any colour.
  const roof = new THREE.ConeGeometry(2.12, 0.45, 4, 1);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 2.55, 0);
  const valance = box(3, 0.22, 3, 0, 2.25, 0);
  const legs = [-1.45, 1.45].flatMap((x) => [-1.45, 1.45].map((z): [THREE.BufferGeometry, number] => [box(0.06, 2.3, 0.06, x, 1.15, z), 0.3]));
  const tentGeo = shaded([[roof, 1], [valance, 0.86], ...legs]);
  // A diamond kite in quarters, two-tone.
  const kiteGeo = new THREE.BufferGeometry();
  const top = [0, 0.75, 0];
  const left = [-0.55, 0.12, 0];
  const bottom = [0, -0.75, 0];
  const right = [0.55, 0.12, 0];
  const mid = [0, 0.12, 0];
  kiteGeo.setAttribute("position", new THREE.Float32BufferAttribute([...top, ...left, ...mid, ...left, ...bottom, ...mid, ...bottom, ...right, ...mid, ...right, ...top, ...mid], 3));
  const tone = [1, 0.55, 1, 0.55].flatMap((k) => Array<number>(9).fill(k));
  kiteGeo.setAttribute("color", new THREE.Float32BufferAttribute(tone, 3));
  kiteGeo.computeVertexNormals();
  const discGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.03, 10);
  const dogGeo = merge([box(0.28, 0.3, 0.75, 0, 0.35, 0), box(0.22, 0.24, 0.26, 0, 0.55, 0.42), box(0.06, 0.06, 0.3, 0, 0.5, -0.45)]);
  // Zilker Eagle cars: an open car with bench backs; the locomotive gets a cab.
  const carGeo = shaded([
    [box(1.1, 0.3, 2.2, 0, 0.35, 0), 1],
    [box(1.1, 0.4, 0.08, 0, 0.7, -1.06), 1],
    [box(1.1, 0.4, 0.08, 0, 0.7, 1.06), 1],
    [box(0.9, 0.12, 2.0, 0, 0.14, 0), 0.25],
  ]);
  const locoGeo = shaded([
    [box(1.1, 0.7, 1.4, 0, 0.55, 0.35), 1],
    [box(1.1, 1.0, 0.8, 0, 0.7, -0.7), 0.8],
    [box(0.24, 0.5, 0.24, 0, 1.15, 0.8), 0.25],
    [box(0.9, 0.12, 2.0, 0, 0.14, 0), 0.25],
  ]);
  const meshes: Meshes = {
    standing: instanced(standGeo(), mat, nPeople),
    seated: instanced(sitGeo, mat, groupPeople + 8),
    riders: instanced(riderGeo, mat, walkers.length + 8),
    lying: instanced(lyingGeo(), mat, swimmers.length + sunbathers.length * 2 + 8),
    heads: instanced(headGeo(), mat, nPeople * 2),
    bikes: instanced(bikeGeo, mat, walkers.length),
    flats: instanced(box(1, 1, 1, 0, 0.5, 0), mat, sunbathers.length + groups.length + 4),
    tents: instanced(tentGeo, trimMat, groups.length + 1),
    kites: instanced(kiteGeo, kiteMat, kites.length + 1),
    discs: instanced(discGeo, mat, pairs.length + 1),
    dogs: instanced(dogGeo, mat, roamers.length + walkers.length),
    cars: instanced(carGeo, trimMat, 8),
  };
  const loco = instanced(locoGeo, trimMat, 1);
  const lineGeo = new THREE.BufferGeometry();
  const segs = kites.length * 8 + 2;
  lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(segs * 6), 3));
  lineGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(segs * 6), 3));
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5 }));
  lines.frustumCulled = false;

  // The Eagle's narrow-gauge track, draped just above the grass.
  const rails: number[] = [];
  for (const l of c.train) {
    for (let i = 0; i + 1 < l.length / 2; i++) {
      for (const j of [i, i + 1]) rails.push(l[j * 2], groundY(ground, l[j * 2], l[j * 2 + 1]) + 0.0004, l[j * 2 + 1]);
    }
  }
  const railGeo = new THREE.BufferGeometry();
  railGeo.setAttribute("position", new THREE.Float32BufferAttribute(rails, 3));
  const track = new THREE.LineSegments(railGeo, new THREE.LineBasicMaterial({ color: "#6d5a48", transparent: true, opacity: 0.7 }));

  const root = new THREE.Group();
  root.add(...Object.values(meshes), loco, lines, track, poolMeshes(pools));
  root.userData.loco = loco;
  root.userData.sim = {
    central: c,
    edges,
    adj,
    walkers,
    pools,
    swimmers,
    sunbathers,
    groups,
    kites,
    pairs,
    roamers,
    lawn,
    train,
    meshes,
    lines,
  } satisfies Sim;
  return root;
}

// ---------------------------------------------------------------- per frame

const q = new THREE.Quaternion();
const e3 = new THREE.Euler();
const v3 = new THREE.Vector3();
const s3 = new THREE.Vector3();
const mOut = new THREE.Matrix4();
const probe = { x: 0, z: 0, dx: 0, dz: 0 };
const TRAIN_COLORS = ["#2f4f3a", "#b8322a", "#e8c34a", "#2f6fb0", "#b8322a", "#e8c34a"].map((c) => new THREE.Color(c));
const STRING = new THREE.Color("#4a4540");
const DISC = new THREE.Color("#f2c230");
const DARK = new THREE.Color("#2a2a2e");

function placeAt(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, rx = 0, rz = 0): THREE.Matrix4 {
  e3.set(rx, yaw, rz, "YXZ");
  q.setFromEuler(e3);
  return mOut.compose(v3.set(x, y, z), q, s3.set(sx, sy, sz));
}

export default function ParkLife({ central, ground, lowPower }: { central: Central; ground: HeightField; lowPower: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const root = useMemo(() => makeSim(central, ground, lowPower), [central, ground, lowPower]);

  useFrame((state, rawDt) => {
    const g = ref.current;
    if (!g) return;
    const cam = runtime.cam;
    const near = cam.dist < 6 && Math.hypot(cam.x + 1.2, cam.z - 0.3) < 8;
    g.visible = near;
    if (!near) return;
    const sim = g.userData.sim as Sim;
    const loco = g.userData.loco as THREE.InstancedMesh;
    const { meshes, edges, adj } = sim;
    const still = runtime.reducedMotion;
    const dt = still ? 0 : Math.min(rawDt, 0.1);
    const t = still ? 0 : state.clock.elapsedTime;
    const tod = runtime.tod;
    const E = figureScale(cam.dist);
    const s = E * M; // metres -> world at figure scale
    const count: Record<keyof Meshes, number> = {
      standing: 0,
      seated: 0,
      riders: 0,
      lying: 0,
      heads: 0,
      bikes: 0,
      flats: 0,
      tents: 0,
      kites: 0,
      discs: 0,
      dogs: 0,
      cars: 0,
    };
    const put = (key: keyof Meshes, m: THREE.Matrix4, c: THREE.Color) => {
      const mesh = meshes[key];
      const i = count[key]++;
      if (i >= mesh.instanceMatrix.count) return;
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c);
    };
    const gy = (x: number, z: number) => groundY(ground, x, z);

    // Trail users, drawn only around the view.
    const reach = Math.max(1.5, cam.dist * 2.6);
    for (const w of sim.walkers) {
      const want = inWindow(tod, w.window);
      w.show += (want - w.show) * (still ? 1 : 1 - Math.exp(-3 * Math.max(dt, 0.016)));
      if (w.show < 0.05) continue;
      let e = edges[w.edge];
      w.d += w.speed * dt;
      let guard = 0;
      while (w.d > e.path.length && guard++ < 4) {
        w.d -= e.path.length;
        const node = w.dir > 0 ? e.b : e.a;
        const options = adj[node].filter((k) => k !== w.edge);
        const next = options.length ? options[Math.floor(Math.random() * options.length)] : w.edge;
        w.edge = next;
        e = edges[next];
        w.dir = e.a === node ? 1 : -1;
      }
      const sAlong = w.dir > 0 ? w.d : e.path.length - w.d;
      e.path.at(sAlong, probe);
      if (Math.abs(probe.x - cam.x) > reach || Math.abs(probe.z - cam.z) > reach) continue;
      const hx = probe.dx * w.dir;
      const hz = probe.dz * w.dir;
      const x = probe.x - hz * w.lateral * E * 0.6;
      const z = probe.z + hx * w.lateral * E * 0.6;
      const tt = e.path.length > 0 ? sAlong / e.path.length : 0;
      const ground0 = gy(x, z);
      let y = ground0;
      if (e.kind === 1) y = Math.max(e.y0 + (e.y1 - e.y0) * tt, ground0 + 0.0012) + 0.0003;
      else if (e.kind === 2 && sampleWaterKm(sim.central, x, z) > 0) {
        y = Math.max(e.y0 + (e.y1 - e.y0) * tt + e.rise * Math.sin(Math.PI * tt), ground0 + 0.006) + 0.0003;
      }
      const yaw = Math.atan2(hx, hz);
      const k = s * w.show;
      if (w.kind === "bike") {
        put("bikes", placeAt(x, y, z, yaw, k, k, k), DARK);
        put("riders", placeAt(x, y + 0.72 * k, z, yaw, k, k, k, 0.35), w.shirt);
        put("heads", placeAt(x + hx * 0.2 * k, y + 1.35 * k, z + hz * 0.2 * k, yaw, k, k, k), w.skin);
      } else {
        const rate = w.kind === "run" ? 2.7 : 1.9;
        const bob = Math.abs(Math.sin((t * rate + w.phase) * Math.PI)) * (w.kind === "run" ? 0.09 : 0.03);
        const lean = w.kind === "run" ? 0.18 : 0.04;
        put("standing", placeAt(x, y + bob * k, z, yaw, k, k, k, lean), w.shirt);
        put("heads", placeAt(x + hx * lean * 1.5 * k, y + (1.62 + bob) * k, z + hz * lean * 1.5 * k, yaw, k, k, k), w.skin);
        if (w.dog) {
          const dx = x - hz * 0.9 * k + hx * 0.8 * k;
          const dz = z + hx * 0.9 * k + hz * 0.8 * k;
          put("dogs", placeAt(dx, y + (gy(dx, dz) - ground0), dz, yaw, k, k, k), w.dog);
        }
      }
    }

    // Swimmers doing lengths; others wade and tread water.
    const swimOn = inWindow(tod, [0.14, 0.86]);
    if (swimOn > 0.1) {
      const kk = s * swimOn;
      for (const sw of sim.swimmers) {
        const p = sim.pools[sw.pool];
        const ax = p.ax;
        sw.u += sw.speed * dt * sw.dir;
        let x = ax.cx + sw.u * ax.ux - sw.v * ax.uz;
        let z = ax.cz + sw.u * ax.uz + sw.v * ax.ux;
        if (sw.speed > 0 && (sw.u < ax.u0 + 0.004 || sw.u > ax.u1 - 0.004 || !pointInPoly(p.poly, x, z))) {
          sw.dir *= -1;
          sw.u += sw.speed * Math.max(dt, 0.02) * sw.dir * 2;
          x = ax.cx + sw.u * ax.ux - sw.v * ax.uz;
          z = ax.cz + sw.u * ax.uz + sw.v * ax.ux;
        }
        const y = p.level;
        if (sw.speed > 0) {
          const yaw = Math.atan2(ax.ux * sw.dir, ax.uz * sw.dir);
          const hx = Math.sin(yaw);
          const hz = Math.cos(yaw);
          // Backs and heads break the surface; the clear water hides the rest.
          put("lying", placeAt(x, y - 0.1 * kk, z, yaw, kk, kk, kk), sw.suit);
          put("heads", placeAt(x + hx * 0.85 * kk, y + 0.02 * kk, z + hz * 0.85 * kk, yaw, kk, kk, kk), sw.skin);
        } else {
          const bob = Math.sin(t * 1.6 + sw.phase) * 0.05;
          put("standing", placeAt(x, y - (1.3 - bob) * kk, z, sw.phase, kk, kk, kk), sw.suit);
          put("heads", placeAt(x, y + (0.32 + bob) * kk, z, sw.phase, kk, kk, kk), sw.skin);
        }
      }
    }

    // Sunbathers on towels.
    const sunOn = inWindow(tod, [0.3, 0.82]);
    if (sunOn > 0.1) {
      const kk = s * sunOn;
      for (const p of sim.sunbathers) {
        const y = gy(p.x, p.z);
        const cy = Math.cos(p.yaw);
        const sy = Math.sin(p.yaw);
        for (const person of p.people) {
          // Towels sit side by side across the group's frame.
          const px = p.x + person.dx * cy * kk;
          const pz = p.z - person.dx * sy * kk;
          put("flats", placeAt(px, y, pz, p.yaw, 0.95 * kk, 0.03 * kk, 1.9 * kk), p.a);
          put("lying", placeAt(px, y + 0.03 * kk, pz, p.yaw, kk, kk, kk), person.shirt);
          put("heads", placeAt(px + sy * 0.85 * kk, y + 0.14 * kk, pz + cy * 0.85 * kk, p.yaw, kk, kk, kk), person.skin);
        }
      }
    }

    // The Great Lawn: picnics and canopy tents, kites, frisbees, strollers and dogs.
    const lawnOn = inWindow(tod, [0.26, 0.84]);
    const pos = sim.lines.geometry.getAttribute("position") as THREE.BufferAttribute;
    const lcol = sim.lines.geometry.getAttribute("color") as THREE.BufferAttribute;
    let seg = 0;
    const line = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: THREE.Color) => {
      pos.setXYZ(seg * 2, x0, y0, z0);
      pos.setXYZ(seg * 2 + 1, x1, y1, z1);
      lcol.setXYZ(seg * 2, c.r, c.g, c.b);
      lcol.setXYZ(seg * 2 + 1, c.r, c.g, c.b);
      seg++;
    };
    if (lawnOn > 0.1) {
      const kk = s * lawnOn;
      for (const b of sim.groups) {
        const y = gy(b.x, b.z);
        const cy = Math.cos(b.yaw);
        const sy = Math.sin(b.yaw);
        if (b.tent) put("tents", placeAt(b.x, y, b.z, b.yaw, kk, kk, kk), b.a);
        else put("flats", placeAt(b.x, y, b.z, b.yaw, 2.2 * kk, 0.03 * kk, 1.8 * kk), b.a);
        for (const p of b.people) {
          const px = b.x + (p.dx * cy + p.dz * sy) * kk;
          const pz = b.z + (-p.dx * sy + p.dz * cy) * kk;
          const yaw = b.yaw + p.yaw;
          put("seated", placeAt(px, y + 0.03 * kk, pz, yaw, kk, kk, kk), p.shirt);
          put("heads", placeAt(px, y + 0.8 * kk, pz, yaw, kk, kk, kk), p.skin);
        }
      }
      const yawDown = Math.atan2(WIND.x, WIND.z);
      const ke = Math.min(E, 2.2) * M * lawnOn; // kites and strings stay nearer true scale than people
      for (const kt of sim.kites) {
        const y = gy(kt.fx, kt.fz);
        put("standing", placeAt(kt.fx, y, kt.fz, yawDown, kk, kk, kk, -0.1), kt.shirt);
        put("heads", placeAt(kt.fx, y + 1.62 * kk, kt.fz, yawDown, kk, kk, kk), kt.skin);
        // The kite rides the wind, swaying and bobbing; string and tail as lines.
        const sway = Math.sin(t * 0.9 + kt.phase) * 4;
        const bob = Math.sin(t * 1.3 + kt.phase * 2) * 2.5;
        const kx = kt.fx + (WIND.x * kt.reach - WIND.z * sway) * ke;
        const kz = kt.fz + (WIND.z * kt.reach + WIND.x * sway) * ke;
        const ky = y + (kt.height + bob) * ke;
        const kScale = ke * 2.4;
        put("kites", placeAt(kx, ky, kz, yawDown + Math.PI, kScale, kScale, kScale, 0.5 + Math.sin(t * 2 + kt.phase) * 0.15, Math.sin(t * 1.7 + kt.phase) * 0.3), kt.color);
        line(kt.fx, y + 1.3 * kk, kt.fz, kx, ky - 0.1 * kScale, kz, STRING);
        let px = kx;
        let py = ky - 0.75 * kScale;
        let pz = kz;
        for (let j = 1; j <= 6; j++) {
          const w = Math.sin(t * 5 + j * 0.9 + kt.phase) * 0.6 * j;
          const nx = kx + (WIND.x * j * 0.9 - WIND.z * w * 0.4) * kScale * 0.9;
          const nz = kz + (WIND.z * j * 0.9 + WIND.x * w * 0.4) * kScale * 0.9;
          const ny = ky - (0.75 + j * 0.5) * kScale;
          line(px, py, pz, nx, ny, nz, kt.color);
          px = nx;
          py = ny;
          pz = nz;
        }
      }
      for (const pr of sim.pairs) {
        const ya = gy(pr.ax, pr.az);
        const yawA = Math.atan2(pr.bx - pr.ax, pr.bz - pr.az);
        put("standing", placeAt(pr.ax, ya, pr.az, yawA, kk, kk, kk), pr.shirts[0]);
        put("heads", placeAt(pr.ax, ya + 1.62 * kk, pr.az, yawA, kk, kk, kk), pr.skins[0]);
        const yb = gy(pr.bx, pr.bz);
        put("standing", placeAt(pr.bx, yb, pr.bz, yawA + Math.PI, kk, kk, kk), pr.shirts[1]);
        put("heads", placeAt(pr.bx, yb + 1.62 * kk, pr.bz, yawA + Math.PI, kk, kk, kk), pr.skins[1]);
        // The disc floats across and back.
        const cyc = (t * 0.45 + pr.phase * 2) % 2;
        const f = cyc < 1 ? cyc : 2 - cyc;
        const e = f * f * (3 - 2 * f);
        const dx = pr.ax + (pr.bx - pr.ax) * e;
        const dz = pr.az + (pr.bz - pr.az) * e;
        const dy = ya + (1.2 + Math.sin(Math.PI * f) * 3.5) * kk;
        put("discs", placeAt(dx, dy, dz, t * 6, kk * 1.6, kk * 1.6, kk * 1.6), DISC);
      }
      for (const r of sim.roamers) {
        if (dt > 0) {
          const a = Math.atan2(r.hz, r.hx) + (Math.random() - 0.5) * dt * (r.skin ? 0.8 : 3);
          r.hx = Math.cos(a);
          r.hz = Math.sin(a);
          const nx = r.x + r.hx * r.speed * dt;
          const nz = r.z + r.hz * r.speed * dt;
          if (sim.lawn && pointInPoly(sim.lawn, nx, nz)) {
            r.x = nx;
            r.z = nz;
          } else {
            r.hx = -r.hx;
            r.hz = -r.hz;
          }
        }
        const yaw = Math.atan2(r.hx, r.hz);
        const y = gy(r.x, r.z);
        if (r.skin) {
          const bob = Math.abs(Math.sin((t * 1.9 + r.phase) * Math.PI)) * 0.03;
          put("standing", placeAt(r.x, y + bob * kk, r.z, yaw, kk, kk, kk, 0.04), r.color);
          put("heads", placeAt(r.x, y + (1.62 + bob) * kk, r.z, yaw, kk, kk, kk), r.skin);
        } else {
          const hop = Math.abs(Math.sin(t * 8 + r.phase)) * 0.12;
          put("dogs", placeAt(r.x, y + hop * kk, r.z, yaw, kk, kk, kk), r.color);
        }
      }
    }
    for (let i = seg; i < pos.count / 2; i++) {
      pos.setXYZ(i * 2, 0, -10, 0);
      pos.setXYZ(i * 2 + 1, 0, -10, 0);
    }
    pos.needsUpdate = true;
    lcol.needsUpdate = true;
    sim.lines.visible = seg > 0;

    // The Zilker Eagle.
    const tr = sim.train;
    const trainOn = inWindow(tod, [0.3, 0.76]);
    loco.count = 0;
    if (tr && trainOn > 0.1) {
      const L = tr.path.length;
      tr.d += 0.0045 * dt * tr.dir;
      if (!tr.closed && (tr.d > L - 0.01 || tr.d < 0.015)) tr.dir *= -1;
      const kk = Math.min(E, 3) * M * trainOn;
      for (let i = 0; i < 6; i++) {
        tr.path.at(tr.d - i * 2.5 * kk * tr.dir, probe);
        const yaw = Math.atan2(probe.dx * tr.dir, probe.dz * tr.dir);
        const y = gy(probe.x, probe.z);
        const m = placeAt(probe.x, y, probe.z, yaw, kk, kk, kk);
        if (i === 0) {
          loco.setMatrixAt(0, m);
          loco.setColorAt(0, TRAIN_COLORS[0]);
          loco.count = 1;
          continue;
        }
        put("cars", m, TRAIN_COLORS[i]);
        put("heads", placeAt(probe.x - probe.dz * 0.25 * kk, y + 0.85 * kk, probe.z + probe.dx * 0.25 * kk, yaw, kk, kk, kk), SKIN[i % SKIN.length]);
        put("heads", placeAt(probe.x + probe.dz * 0.25 * kk, y + 0.85 * kk, probe.z - probe.dx * 0.25 * kk, yaw, kk, kk, kk), SKIN[(i + 2) % SKIN.length]);
      }
      loco.instanceMatrix.needsUpdate = true;
      if (loco.instanceColor) loco.instanceColor.needsUpdate = true;
    }

    // Upload only the live part of each buffer; the parks hold well over a thousand people.
    for (const key of Object.keys(meshes) as (keyof Meshes)[]) {
      const mesh = meshes[key];
      const n = Math.min(count[key], mesh.instanceMatrix.count);
      mesh.count = n;
      if (n === 0) continue;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, n * 3);
        mesh.instanceColor.needsUpdate = true;
      }
    }
  });

  return <primitive ref={ref} object={root} />;
}
