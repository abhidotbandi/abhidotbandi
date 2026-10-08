"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import earcut from "earcut";
import * as THREE from "three";
import { CLOSED_RUNWAY, GATES, RUNWAYS, RUNWAY_HALF, SOLAR, TERMINAL, TOWER, YELLOW_GARAGE } from "@/lib/atlas/airport";
import { buildingGeometry } from "@/lib/atlas/buildings";
import { STYLE_TERMINAL, extrudeBuildings } from "@/lib/atlas/extrude";
import { BUILDING_EXAG, groundY, project, type HeightField } from "@/lib/atlas/geo";
import { pointInPoly } from "@/lib/atlas/polygon";
import { runtime } from "@/lib/atlas/store";
import { sky } from "@/lib/atlas/timeOfDay";
import { makeBuildingMaterial } from "./Buildings";
import { box, instanced, merge } from "./figures";
import { aoCaster } from "./Occlusion";
import { LIT, paintMaterial, sharedUniforms, updatePaint, type SharedPaint } from "./paint";
import { SHADOW_VERTEX_PARS, shadowVertex } from "./shadows";

// Austin-Bergstrom International, readable from across the city as well as up close, in its own
// colours (matched to USGS imagery): its two concrete runways painted as they are (threshold bars,
// designators, touchdown zone and aiming point markings, centreline and edges; tyre rubber down
// the touchdown zones; the west runway's wide shoulders, hatched; dark blast pads with chevrons
// beyond the thresholds; edge and threshold lights after dark), drawn from any distance;
// airliners in their liveries at the Barbara Jordan Terminal's gates, with their jet bridges and
// lead-in lines, larger the further out you are; the control tower; the solar canopies and the
// garages' solar roofs; airliners on final over East Austin, touching down on the west runway and
// turning off for the terminal, departures rolling and climbing out to the south from the east
// runway. Landing lights, beacons and wingtip lights after dark. (The taxiways, aprons and car
// parks come with the detail tiles; the turf between them with the terrain.)

const M = 0.001;
const SCALE = 1.5; // airliners read at airport scale
/** Parked at the gates a little smaller, so neighbours' wings clear. */
const PARKED = 1.2 / SCALE;
const V = BUILDING_EXAG;

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _e = new THREE.Euler();

/**
 * Who flies from Austin and how each looks from above: the fuselage and the tail, by about how
 * many of the gates each has (Southwest, the biggest, in its blue Heart livery; American in
 * silver; the rest white with their tails).
 */
const LIVERIES = [
  { share: 8, body: "#304cb2", fin: "#d4202f" }, // Southwest
  { share: 4, body: "#bfc4ca", fin: "#24407a" }, // American
  { share: 3, body: "#f3f2ee", fin: "#0b2a5b" }, // Delta
  { share: 3, body: "#f3f2ee", fin: "#1b3f8b" }, // United
  { share: 1, body: "#f3f2ee", fin: "#01426a" }, // Alaska
  { share: 1, body: "#f3f2ee", fin: "#2a62c9" }, // JetBlue
  { share: 1, body: "#f3f2ee", fin: "#2e8540" }, // Frontier
  { share: 1, body: "#f3f2ee", fin: "#f2a900" }, // Allegiant
].map((l) => ({ share: l.share, body: new THREE.Color(l.body), fin: new THREE.Color(l.fin) }));
type Livery = (typeof LIVERIES)[number];
const WING = new THREE.Color("#cdd1d6");

/** A livery picked by share. */
function anyLivery(r: number): Livery {
  const total = LIVERIES.reduce((t, l) => t + l.share, 0);
  let x = r * total;
  for (const l of LIVERIES) if ((x -= l.share) < 0) return l;
  return LIVERIES[0];
}

/** An airliner in metres, nose toward -z, in the three parts its livery paints differently: the
 * fuselage, the wings, tailplane and engines, and the tail fin. */
function planeGeometry(): { body: THREE.BufferGeometry; wings: THREE.BufferGeometry; fin: THREE.BufferGeometry } {
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
  const fin = box(0.45, 6.5, 4.6, 0, 0, 0);
  fin.rotateX(-0.45);
  fin.translate(0, 4.8, 16.4);
  const parts = {
    body: merge([fuselage, nose, tail]),
    wings: merge([wing(1), wing(-1), stab(1), stab(-1), engine(1), engine(-1)]),
    fin: merge([fin]),
  };
  for (const g of Object.values(parts)) g.scale(M * SCALE, M * SCALE, M * SCALE);
  return parts;
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
  const T = RUNWAYS[0].n;
  const [dx, dz] = unit(RUNWAYS[0].n, RUNWAYS[0].s);
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
  const T = RUNWAYS[1].n;
  const [dx, dz] = unit(RUNWAYS[1].n, RUNWAYS[1].s);
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

// --- the runways -------------------------------------------------------------------------------

/** The glyphs runway designators need, 3 x 5 cells, top row first: a bit per painted cell. */
function glyph(rows: string[]): number {
  let bits = 0;
  rows.forEach((r, ri) => [...r].forEach((c, ci) => (bits += c === "1" ? 2 ** (ri * 3 + ci) : 0)));
  return bits;
}
const GLYPHS: Record<string, number> = {
  "1": glyph(["010", "110", "010", "010", "111"]),
  "3": glyph(["111", "001", "111", "001", "111"]),
  "5": glyph(["111", "100", "111", "001", "111"]),
  "7": glyph(["111", "001", "001", "010", "010"]),
  L: glyph(["100", "100", "100", "100", "111"]),
  R: glyph(["110", "101", "110", "101", "101"]),
};
const f = (n: number) => n.toFixed(1);
const ends = RUNWAYS.map((r) => [r.north, r.south]);

const runwayVertex = /* glsl */ `
  attribute vec4 aAcross;
  attribute vec3 aRwy;
  uniform float uPxK;
  uniform float uLift;
  varying vec3 vWorld;
  varying vec2 vUV;
  varying vec2 vInfo;
  varying float vSide;
  varying float vDepth;
  #include <fog_pars_vertex>
  ${SHADOW_VERTEX_PARS}
  void main() {
    vec4 c = viewMatrix * vec4(position, 1.0);
    // Never much thinner than a pixel and a half, so a runway still shows from across the region.
    float hw = max(aAcross.w, 0.7 * uPxK * max(-c.z, 1e-3));
    vec3 p = position + vec3(aAcross.x, 0.0, aAcross.y) * (aAcross.z * hw);
    p.y += uLift;
    vWorld = p;
    vSide = aAcross.z;
    // metres from the north threshold; metres across, + to the west
    vUV = vec2(aRwy.x, aAcross.z * aAcross.w * 1000.0);
    vInfo = aRwy.yz;
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    vDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
    ${shadowVertex("p")}
  }
`;

const runwayFragment = /* glsl */ `
  ${LIT}
  uniform float uHalfM;
  varying vec3 vWorld;
  varying vec2 vUV;
  varying vec2 vInfo;
  varying float vSide;
  varying float vDepth;
  #include <fog_pars_fragment>

  // How much of the pixel's footprint [x - w/2, x + w/2] lies in [a, b]: box-filtered, so the
  // markings stay clean (and average out to grey, rather than shimmer) at any distance.
  float span(float x, float a, float b, float w) {
    return clamp((min(x + 0.5 * w, b) - max(x - 0.5 * w, a)) / w, 0.0, 1.0);
  }
  // The same for stripes D wide every P, from x = 0.
  float stripes(float x, float P, float D, float w) {
    float a = x - 0.5 * w;
    float b = x + 0.5 * w;
    float ia = floor(a / P) * D + min(mod(a, P), D);
    float ib = floor(b / P) * D + min(mod(b, P), D);
    return (ib - ia) / w;
  }
  float hash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
  float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    return mix(hash1(i), hash1(i + 1.0), f * f * (3.0 - 2.0 * f));
  }
  // A designator glyph: 3 cells of 2 m across, 5 of 3.66 m (18.3 m) along, painted where its
  // bit is set; from afar, the grey its paint averages to.
  float glyphAt(float bits, vec2 p, vec2 w) {
    vec2 cell = vec2(2.0, 3.66);
    float box = span(p.x, 0.0, 6.0, w.x) * span(p.y, 0.0, 18.3, w.y);
    if (box <= 0.0) return 0.0;
    float col = clamp(floor(p.x / cell.x), 0.0, 2.0);
    float row = 4.0 - clamp(floor(p.y / cell.y), 0.0, 4.0);
    float bit = mod(floor(bits / exp2(row * 3.0 + col)), 2.0);
    return box * mix(bit, 0.5, smoothstep(0.4, 1.2, max(w.x / cell.x, w.y / cell.y)));
  }
  // One end's markings: a = metres in from its threshold, s = metres from the centreline, gx =
  // metres to the right of an aircraft landing there.
  float endMarks(float a, float s, float gx, vec2 w, float letter, float d0, float d1) {
    float m = 0.0;
    // Threshold bars: twelve, 1.75 m wide and as far apart, 45.7 m long, from 6 m in.
    m += span(a, 6.0, 51.7, w.y) * span(s, 1.75, 22.75, w.x) * stripes(s - 1.75, 3.5, 1.75, w.x);
    // The designator, read from the approach: the side letter first, then the number.
    m += glyphAt(letter, vec2(gx + 3.0, a - 63.7), w.xy);
    m += glyphAt(d0, vec2(gx + 8.0, a - 88.0), w.xy);
    m += glyphAt(d1, vec2(gx - 2.0, a - 88.0), w.xy);
    // Touchdown zone: bars in threes, twos and ones every 500 ft; the aiming point at 1,000 ft.
    float tdz = stripes(s - 11.0, 3.3, 1.8, w.x);
    m += span(a, 152.0, 174.9, w.y) * span(s, 11.0, 19.4, w.x) * tdz;
    m += span(a, 305.0, 350.7, w.y) * span(s, 11.0, 20.1, w.x);
    m += (span(a, 457.0, 479.9, w.y) + span(a, 610.0, 632.9, w.y)) * span(s, 11.0, 16.1, w.x) * tdz;
    m += (span(a, 762.0, 784.9, w.y) + span(a, 914.0, 936.9, w.y)) * span(s, 11.0, 12.8, w.x);
    return m;
  }

  void main() {
    float L = vInfo.x;
    float u = vUV.x;
    float v = vUV.y;
    // (x across, y along: the pixel's footprint in metres)
    vec2 w = vec2(max(fwidth(v), 1e-3), max(fwidth(u), 1e-3));
    float half_ = uHalfM;
    float west = step(vInfo.y, 0.5);
    float shoulder = mix(${f(RUNWAYS[1].shoulder)}, ${f(RUNWAYS[0].shoulder)}, west);
    bool north = u < 0.5 * L;
    // Metres in from the nearer threshold (less than 0 on its blast pad).
    float a = north ? u : L - u;
    // Landing south, an aircraft's right is the runway's west (+v); landing north, its east.
    float gx = north ? v : -v;
    float letter = north
      ? mix(${f(GLYPHS[ends[1][0][1]])}, ${f(GLYPHS[ends[0][0][1]])}, west)
      : mix(${f(GLYPHS[ends[1][1][1]])}, ${f(GLYPHS[ends[0][1][1]])}, west);
    float d0 = north ? ${f(GLYPHS[ends[0][0][0][0]])} : ${f(GLYPHS[ends[0][1][0][0]])};
    float d1 = north ? ${f(GLYPHS[ends[0][0][0][1]])} : ${f(GLYPHS[ends[0][1][0][1]])};
    float s = abs(v);
    // (The closed runway in the infield: plain concrete, its X's, no lights.)
    float open = 1.0 - step(1.5, vInfo.y);
    float runway = span(s, -half_, half_, w.x); // of the pixel on the 150 ft itself, not its shoulders
    float pad = span(a, -1e4, 0.0, w.y) * open; // ...and beyond the threshold
    float near = 1.0 - smoothstep(1.0, 4.0, max(w.x, w.y));

    // Light concrete, the shoulders a shade darker, in 7.5 m slabs whose joints show up close;
    // past the thresholds the blast pads, dark asphalt between the shoulders.
    vec3 col = mix(lin(vec3(0.7, 0.69, 0.64)), lin(vec3(0.8, 0.79, 0.74)), runway);
    vec2 slab = vec2(v, u) / 7.5;
    vec2 j = 0.5 - abs(fract(slab) - 0.5);
    col *= 1.0 - 0.06 * (1.0 - smoothstep(0.0, 0.08, min(j.x, j.y))) * (1.0 - smoothstep(0.5, 1.5, max(w.x, w.y)));
    col = mix(col, lin(vec3(0.43, 0.45, 0.48)), runway * pad);
    // Tyre rubber: dark down the middle of each touchdown zone and on along the rollout, in
    // streaks (which even out from afar).
    float streak = mix(0.7, noise1(v * 0.8 + 7.0) * 0.6 + noise1(u * 0.02 + v * 0.5) * 0.4, near);
    float rubber = (1.0 - smoothstep(2.0, 11.0, s)) * span(a, 80.0, 1500.0, w.y) * (0.45 + 0.55 * span(a, 140.0, 900.0, w.y));
    col *= 1.0 - 0.55 * rubber * streak * open;

    // White paint: the markings at each end, the centreline (120 ft dashes, 80 ft apart, between
    // the designators) and the edge lines.
    float on = span(u, 0.0, L, w.y);
    float m = endMarks(a, s, gx, w, letter, d0, d1);
    m += span(u, 120.0, L - 120.0, w.y) * span(v, -0.45, 0.45, w.x) * stripes(u - 120.0, 61.0, 36.6, w.y);
    m += span(s, half_ - 1.4, half_ - 0.5, w.x) * on;
    m *= open;
    // Yellow: hatching at 45 degrees across the wide shoulders, and chevrons on the blast pads
    // pointing to the threshold; a closed runway's X every 300 m.
    float y = step(10.0, shoulder) * span(s, half_ + 1.5, half_ + shoulder - 1.5, w.x) * stripes(a + s, 30.0, 1.5, w.x + w.y) * on * open;
    y += pad * span(s, -1.0, half_ - 2.5, w.x) * stripes(-a - s, 30.0, 1.8, w.x + w.y);
    float xa = mod(u, 300.0) - 150.0;
    y += (1.0 - open) * (span(xa - v, -1.3, 1.3, w.x + w.y) + span(xa + v, -1.3, 1.3, w.x + w.y)) * span(xa, -10.0, 10.0, w.y) * span(v, -10.0, 10.0, w.x) * span(u, 100.0, L - 100.0, w.y);
    col = mix(col, lin(vec3(0.97, 0.97, 0.95)), clamp(m, 0.0, 1.0) * 0.92);
    col = mix(col, lin(vec3(0.95, 0.76, 0.24)), clamp(y, 0.0, 1.0) * 0.85);
    vec3 lit = groundLit(col, vWorld);

    // After dark: white edge lights every 60 m, green across the thresholds.
    float dark = smoothstep(0.35, 1.0, uNight) * open;
    float mpp = max(w.x, w.y);
    float rad = max(1.3, 1.1 * mpp);
    float de = length(vec2((fract(u / 60.0) - 0.5) * 60.0, s - (half_ - 0.6)));
    lit += lin(vec3(1.0, 0.92, 0.78)) * exp(-de * de / (rad * rad)) * 2.2 * mix(0.25, 1.0, smoothstep(2.0, 7.0, 60.0 / mpp)) * dark * on;
    float dt = length(vec2(a - 1.0, (fract(v / 3.0) - 0.5) * 3.0));
    lit += lin(vec3(0.3, 1.0, 0.45)) * exp(-dt * dt / (rad * rad)) * 1.8 * dark * step(s, half_);

    float aa = max(fwidth(vSide), 1e-4) * 1.5;
    gl_FragColor = vec4(lit, uFade * (1.0 - smoothstep(1.0 - aa, 1.0, abs(vSide))) * (1.0 - 0.5 * smoothstep(30.0, 80.0, vDepth)));
    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

/** Each runway as a strip along its centreline, from the end of one blast pad to the other, every
 * 25 m so it lies on the ground, as wide as its paved shoulders; then the closed one. */
function runwayMesh(ground: HeightField, shared: SharedPaint): THREE.Mesh {
  const pos: number[] = [];
  const across: number[] = [];
  const info: number[] = [];
  const index: number[] = [];
  const strips = [
    ...RUNWAYS.map((r) => ({ n: r.n, s: r.s, padN: r.padN, padS: r.padS, half: RUNWAY_HALF + r.shoulder / 1000 })),
    { ...CLOSED_RUNWAY, padN: 0, padS: 0 },
  ];
  strips.forEach((r, k) => {
    const [nx, nz] = r.n;
    const [sx, sz] = r.s;
    const len = Math.hypot(sx - nx, sz - nz);
    const dx = (sx - nx) / len;
    const dz = (sz - nz) / len;
    const from = -r.padN / 1000;
    const to = len + r.padS / 1000;
    const n = Math.ceil((to - from) / 0.025);
    const half = r.half;
    const base = pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const d = from + ((to - from) * i) / n;
      const x = nx + dx * d;
      const z = nz + dz * d;
      const y = groundY(ground, x, z);
      for (const side of [-1, 1]) {
        pos.push(x, y, z);
        across.push(-dz, dx, side, half);
        info.push(d * 1000, len * 1000, k);
      }
      if (i) {
        const q = base + (i - 1) * 2;
        index.push(q, q + 1, q + 3, q, q + 3, q + 2);
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aAcross", new THREE.Float32BufferAttribute(across, 4));
  geo.setAttribute("aRwy", new THREE.Float32BufferAttribute(info, 3));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  const mat = paintMaterial(shared, { value: 1 }, runwayVertex, runwayFragment);
  mat.uniforms.uHalfM = { value: RUNWAY_HALF * 1000 };
  const mesh = new THREE.Mesh(geo, mat);
  // Over the taxiways where they cross (the tiles' paint draws first).
  mesh.renderOrder = 0;
  return mesh;
}

// --- lead-in lines -----------------------------------------------------------------------------

const lineVertex = /* glsl */ `
  attribute vec4 aAcross;
  uniform float uPxK;
  uniform float uLift;
  varying vec3 vWorld;
  varying float vCover;
  varying float vDepth;
  #include <fog_pars_vertex>
  ${SHADOW_VERTEX_PARS}
  void main() {
    vec4 c = viewMatrix * vec4(position, 1.0);
    // Drawn at least half a pixel wide, fainter for it: as much paint as there is.
    float hw = max(aAcross.w, 0.5 * uPxK * max(-c.z, 1e-3));
    vCover = aAcross.w / hw;
    vec3 p = position + vec3(aAcross.x, 0.0, aAcross.y) * (aAcross.z * hw);
    p.y += uLift;
    vWorld = p;
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    vDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
    ${shadowVertex("p")}
  }
`;

const lineFragment = /* glsl */ `
  ${LIT}
  varying vec3 vWorld;
  varying float vCover;
  varying float vDepth;
  #include <fog_pars_fragment>
  void main() {
    vec3 lit = groundLit(lin(vec3(0.95, 0.77, 0.22)), vWorld);
    gl_FragColor = vec4(lit, uFade * min(1.0, vCover) * 0.9 * (1.0 - smoothstep(5.0, 10.0, vDepth)));
    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

/** The yellow lead-in line into each stand, along the parked aircraft's axis from the taxilane
 * behind it, and the stop bar across it where the nose wheel stops. */
function leadInMesh(ground: HeightField, shared: SharedPaint): THREE.Mesh {
  const pos: number[] = [];
  const across: number[] = [];
  const index: number[] = [];
  const line = (ax: number, az: number, bx: number, bz: number, halfM: number) => {
    const l = Math.hypot(bx - ax, bz - az);
    const px = -(bz - az) / l;
    const pz = (bx - ax) / l;
    const base = pos.length / 3;
    for (const [x, z] of [
      [ax, az],
      [bx, bz],
    ]) {
      for (const side of [-1, 1]) {
        pos.push(x, groundY(ground, x, z), z);
        across.push(px, pz, side, halfM / 1000);
      }
    }
    index.push(base, base + 1, base + 3, base, base + 3, base + 2);
  };
  for (const st of STANDS) {
    // From the stop bar back past the tail, onto the taxilane.
    line(st.x, st.z, st.x - st.fx * 0.075, st.z - st.fz * 0.075, 0.1);
    line(st.x - st.fz * 0.0015, st.z + st.fx * 0.0015, st.x + st.fz * 0.0015, st.z - st.fx * 0.0015, 0.15);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aAcross", new THREE.Float32BufferAttribute(across, 4));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, paintMaterial(shared, { value: 1 }, lineVertex, lineFragment));
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  return mesh;
}

// --- solar -------------------------------------------------------------------------------------

/** The solar arrays: a thin slab per row of panels, on its canopy's posts or its garage's roof. */
function solarMesh(ground: HeightField): THREE.Group {
  const out = new THREE.Group();
  for (const canopy of [true, false]) {
    const rows: THREE.Matrix4[] = [];
    for (const arr of SOLAR.filter((a) => a.canopy === canopy)) {
      const at = (u: number, v: number): [number, number] => [
        arr.origin[0] + (arr.along[0] * u + arr.left[0] * v) * M,
        arr.origin[1] + (arr.along[1] * u + arr.left[1] * v) * M,
      ];
      // A roof is level, at its height above the lowest ground under the building.
      let floor = Infinity;
      for (const [u0, v0, u1, v1] of arr.blocks) {
        for (const [u, v] of [
          [u0, v0],
          [u1, v0],
          [u0, v1],
          [u1, v1],
        ]) {
          floor = Math.min(floor, groundY(ground, ...at(u, v)));
        }
      }
      const yaw = Math.atan2(-arr.along[1], arr.along[0]);
      _quat.setFromAxisAngle(_up, yaw);
      for (const [u0, v0, u1, v1] of arr.blocks) {
        const width = arr.pitch - arr.gap;
        for (let r = Math.min(v0, v1); r + width <= Math.max(v0, v1) + 0.5; r += arr.pitch) {
          const [x, z] = at((u0 + u1) / 2, r + width / 2);
          const y = (canopy ? groundY(ground, x, z) : floor) + (arr.height + 0.4) * M * V;
          _m.compose(_p.set(x, y, z), _quat, _s.set(Math.abs(u1 - u0) * M, 0.3 * M * V, width * M));
          rows.push(_m.clone());
        }
      }
    }
    const mesh = new THREE.InstancedMesh(box(1, 1, 1, 0, 0, 0), new THREE.MeshLambertMaterial({ color: "#36547f" }), rows.length);
    rows.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = canopy;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    out.add(mesh);
  }
  return out;
}

// --- the control tower -----------------------------------------------------------------------

/** Geometries merged with a colour each (linear), into one with a color attribute. */
function painted(parts: [THREE.BufferGeometry, string][]): THREE.BufferGeometry {
  const geos = parts.map(([g, c]) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.deleteAttribute("uv");
    const col = new THREE.Color(c);
    const arr = new Float32Array(n.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) arr.set([col.r, col.g, col.b], i);
    n.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    return n;
  });
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "color"]) {
    const total = geos.reduce((t, g) => t + g.attributes[name].array.length, 0);
    const arr = new Float32Array(total);
    let o = 0;
    for (const g of geos) {
      arr.set(g.attributes[name].array as Float32Array, o);
      o += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  return out;
}

/** An octagonal piece of the tower, in metres: radii at the bottom and top, from y0 to y1. */
function oct(rBottom: number, rTop: number, y0: number, y1: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, y1 - y0, 8, 1);
  g.rotateY(Math.PI / 8);
  g.translate(0, (y0 + y1) / 2, 0);
  return g;
}

/**
 * Austin-Bergstrom's tower: a concrete shaft rising out of its base building, a flared deck, the
 * slanted glass cab, its roof and antenna; the base building and its annex beside it. Built in
 * metres, raised like the map's other buildings (BUILDING_EXAG). The cab glows after dark.
 */
function towerMeshes(ground: HeightField): { solid: THREE.Mesh; cab: THREE.Mesh; beacon: THREE.Vector3 } {
  const CONCRETE = "#ddd6c8";
  const WHITE = "#f1f0ea";
  const top = TOWER.heightM;
  const shaft = painted([
    [oct(4.8, 4.2, 0, top - 17), CONCRETE],
    [oct(4.2, 7.6, top - 17, top - 13.5), CONCRETE],
    [oct(8.4, 8.4, top - 13.5, top - 12.9), WHITE],
    [oct(8.9, 8.9, top - 6.2, top - 5.0), WHITE],
    [oct(6.2, 3.2, top - 5.0, top - 2.6), WHITE],
    [oct(0.25, 0.25, top - 2.6, top + 5), "#8a8d91"],
  ]);
  const cabGeo = oct(7.4, 8.3, top - 12.9, top - 6.2);
  const [tx, tz] = TOWER.shaft;
  const gy = groundY(ground, tx, tz);
  const place = (g: THREE.BufferGeometry, x: number, z: number, turn = 0) => {
    g.scale(M, M * V, M);
    g.rotateY(-turn);
    g.translate(x, groundY(ground, x, z) - 0.0005, z);
    return g;
  };
  const blocks = painted([
    [box(TOWER.base.l, 12, TOWER.base.w, 0, 6, 0), CONCRETE],
    [box(TOWER.base.l + 1.2, 0.8, TOWER.base.w + 1.2, 0, 12.2, 0), WHITE],
  ]);
  const annex = painted([[box(TOWER.annex.l, 7, TOWER.annex.w, 0, 3.5, 0), CONCRETE]]);
  const parts = [
    place(shaft, tx, tz),
    place(blocks, TOWER.base.at[0], TOWER.base.at[1], TOWER.turn),
    place(annex, TOWER.annex.at[0], TOWER.annex.at[1], TOWER.turn),
  ];
  const solidGeo = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "color"]) {
    const arrs = parts.map((g) => g.attributes[name].array as Float32Array);
    const arr = new Float32Array(arrs.reduce((t, a) => t + a.length, 0));
    let o = 0;
    for (const a of arrs) {
      arr.set(a, o);
      o += a.length;
    }
    solidGeo.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  solidGeo.computeBoundingSphere();
  const solid = new THREE.Mesh(solidGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  solid.castShadow = solid.receiveShadow = true;
  place(cabGeo, tx, tz);
  cabGeo.computeBoundingSphere();
  const cab = new THREE.Mesh(cabGeo, new THREE.MeshLambertMaterial({ color: "#35505c", emissive: "#ffd9a0", emissiveIntensity: 0 }));
  cab.castShadow = true;
  return { solid, cab, beacon: new THREE.Vector3(tx, gy + (top + 5.4) * M * V, tz) };
}

// --- the Yellow Garage, going up -----------------------------------------------------------------

/**
 * The Yellow Garage mid-build (YELLOW_GARAGE), in metres, raised like the map's buildings: bare
 * concrete decks a storey apart over a dark core, columns round the outside every 9 m. The built
 * part stands at full height, its decks edged with barriers, its stair cores topped in the
 * garage's yellow and light poles on its top deck; the rest is a few levels up, its columns
 * rising from its top deck. Two tower cranes work over it.
 */
function yellowGarageMesh(ground: HeightField): THREE.Mesh {
  const G = YELLOW_GARAGE;
  const ex = G.se[0] - G.sw[0];
  const ez = G.se[1] - G.sw[1];
  const nx = G.nw[0] - G.sw[0];
  const nz = G.nw[1] - G.sw[1];
  const len = Math.hypot(ex, ez) / M - 2 * G.inset[0];
  const wid = Math.hypot(nx, nz) / M - 2 * G.inset[1];
  const turn = Math.atan2(ez, ex);
  const cx = G.sw[0] + (ex + nx) / 2;
  const cz = G.sw[1] + (ez + nz) / 2;
  const CONCRETE = "#cfcabf";
  const EDGE = "#e4e0d6";
  const CORE = "#3a3d42";
  const YELLOW = "#efbd1d";
  const parts: [THREE.BufferGeometry, string][] = [];
  const top = (G.levels - 1) * G.storey;
  // The built part from the west end, the rest east of it (local x runs east, z south).
  const x0 = -len / 2;
  const xb = x0 + len * G.built;
  const x1 = len / 2;
  const part = (a: number, b: number, levels: number, finished: boolean) => {
    const l = b - a;
    const mid = (a + b) / 2;
    const deckTop = (levels - 1) * G.storey;
    // (The core stops under the top deck, so the two never fight for the same plane.)
    parts.push([box(l - 4, deckTop - 0.6, wid - 4, mid, (deckTop - 0.6) / 2, 0), CORE]);
    for (let k = 1; k < levels; k++) {
      const y = k * G.storey;
      parts.push([box(l, 0.4, wid, mid, y - 0.2, 0), CONCRETE]);
      if (!finished) continue;
      // The deck's edge and barrier, along both sides and across the west end.
      parts.push([box(l, 1.1, 0.3, mid, y + 0.55, -wid / 2 + 0.15), EDGE]);
      parts.push([box(l, 1.1, 0.3, mid, y + 0.55, wid / 2 - 0.15), EDGE]);
      if (a === x0) parts.push([box(0.3, 1.1, wid, a + 0.15, y + 0.55, 0), EDGE]);
    }
    // Columns round the outside, rising past an unfinished top deck.
    const colH = finished ? deckTop : deckTop + 3.2;
    for (let x = a + 0.4; x <= b - 0.3; x += 9) {
      for (const z of [-wid / 2 + 0.3, wid / 2 - 0.3]) parts.push([box(0.6, colH, 0.6, x, colH / 2, z), CONCRETE]);
    }
    if (a === x0) for (let z = -wid / 2 + 9; z < wid / 2 - 4; z += 9) parts.push([box(0.6, colH, 0.6, a + 0.3, colH / 2, z), CONCRETE]);
  };
  part(x0, xb, G.levels, true);
  part(xb, x1, G.rising, false);
  // Stair and lift cores at the built part's corners, their tops in yellow; light poles on its top deck.
  for (const [x, z] of [
    [x0 + 6, -wid / 2 + 7],
    [xb - 8, wid / 2 - 7],
  ]) {
    parts.push([box(7, top + 2, 9, x, (top + 2) / 2, z), "#bdb8ad"]);
    parts.push([box(7.2, 2.2, 9.2, x, top + 3.1, z), YELLOW]);
  }
  for (let x = x0 + 20; x < xb - 10; x += 26) {
    for (const z of [-wid / 4, wid / 4]) parts.push([box(0.3, 9, 0.3, x, top + 4.5, z), "#8d9196"]);
  }
  // Tower cranes: a lattice mast (drawn solid), the jib out over the work and the counter-jib
  // with its ballast, the cab under the slewing ring.
  const crane = (x: number, z: number, h: number, jib: number, slew: number) => {
    const g: [THREE.BufferGeometry, string][] = [
      [box(1.8, h, 1.8, 0, h / 2, 0), YELLOW],
      [box(jib, 1.4, 1.4, jib / 2 - 1, h + 0.7, 0), YELLOW],
      [box(16, 1.2, 1.6, -8, h + 0.6, 0), YELLOW],
      [box(4, 2.6, 2.6, -14, h + 0.3, 0), "#9a9a96"],
      [box(1.4, 6, 1.4, 0, h + 4.4, 0), YELLOW],
      [box(2.2, 2.4, 2.4, 1.6, h - 1.4, 0), "#f4f2ec"],
      [box(0.15, h * 0.45, 0.15, jib * 0.62, h - h * 0.225, 0), "#3a3a3a"],
    ];
    for (const [geo] of g) {
      geo.rotateY(-slew);
      geo.translate(x, 0, z);
    }
    parts.push(...g);
  };
  crane(xb + 4, -wid / 2 - 7, 46, 56, 0.25);
  crane(x1 - 30, wid / 2 + 8, 42, 50, Math.PI - 0.6);
  const geo = painted(parts);
  geo.scale(M, M * V, M);
  geo.rotateY(-turn);
  let floor = Infinity;
  for (const [u, w] of [
    [-len / 2, -wid / 2],
    [len / 2, -wid / 2],
    [len / 2, wid / 2],
    [-len / 2, wid / 2],
  ]) {
    floor = Math.min(floor, groundY(ground, cx + (Math.cos(turn) * u - Math.sin(turn) * w) * M, cz + (Math.sin(turn) * u + Math.cos(turn) * w) * M));
  }
  geo.translate(cx, floor - 0.0005, cz);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

// --- the Barbara Jordan Terminal ----------------------------------------------------------------

/**
 * The terminal's parts (TERMINAL, from scripts/atlas/build_terminal.py), extruded and shaded like
 * the map's buildings, in its own style: glass curtain walls between grey piers under a metal
 * fascia, and pale metal roofs.
 */
function terminalMesh(ground: HeightField): THREE.Mesh {
  const parts = TERMINAL.parts;
  const n = parts.reduce((t, p) => t + p.ring.length / 2, 0);
  const x = new Int32Array(n);
  const z = new Int32Array(n);
  const ringStart = new Uint32Array(parts.length + 1);
  const vertStart = new Uint32Array(parts.length + 1);
  const height = new Uint16Array(parts.length);
  let v = 0;
  parts.forEach((p, i) => {
    ringStart[i] = i;
    vertStart[i] = v;
    for (let j = 0; j < p.ring.length; j += 2) {
      x[v] = Math.round(p.ring[j] * 1000);
      z[v] = Math.round(p.ring[j + 1] * 1000);
      v++;
    }
    height[i] = Math.round(p.h * 10);
  });
  ringStart[parts.length] = parts.length;
  vertStart[parts.length] = v;
  const data = { sites: [], count: parts.length, height, site: new Int16Array(parts.length).fill(-1), ringStart, vertStart, x, z };
  const a = extrudeBuildings(data, ground, [], 0, 0, undefined, () => STYLE_TERMINAL);
  const mesh = new THREE.Mesh(buildingGeometry(a), makeBuildingMaterial());
  mesh.castShadow = mesh.receiveShadow = true;
  aoCaster(mesh);
  return mesh;
}

/** A flat slab over a ring (flat scene km) from y0 to y1 (world), its sides walled. */
function slab(ring: Float32Array, y0: number, y1: number): THREE.BufferGeometry {
  const n = ring.length / 2;
  const pos: number[] = [];
  const tris = earcut(Array.from(ring));
  for (const y of [y1, y0]) for (const t of tris) pos.push(ring[t * 2], y, ring[t * 2 + 1]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [ax, az, bx, bz] = [ring[i * 2], ring[i * 2 + 1], ring[j * 2], ring[j * 2 + 1]];
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * The departures roadway (Overture's trestle): a concrete deck at the upper level, TERMINAL.deckM
 * up, with its parapet, on piers every 16 m, and the skybridges to the Red Garage. Over its curb,
 * the terminal's canopies: gull-winged steel roofs (the photographs' white frames over red
 * panels) on posts from the deck.
 */
function landsideMesh(ground: HeightField): THREE.Mesh {
  const D = TERMINAL.deck;
  let floor = Infinity;
  let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < D.length; i += 2) {
    floor = Math.min(floor, groundY(ground, D[i], D[i + 1]));
    [x0, z0, x1, z1] = [Math.min(x0, D[i]), Math.min(z0, D[i + 1]), Math.max(x1, D[i]), Math.max(z1, D[i + 1])];
  }
  const up = (m: number) => floor + m * M * V;
  const deckTop = up(TERMINAL.deckM);
  const parts: [THREE.BufferGeometry, string][] = [[slab(D, up(TERMINAL.deckM - 1.3), deckTop), "#d6d1c6"]];
  // The parapet: a low wall round the deck's edge.
  const n = D.length / 2;
  const wall: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [ax, az, bx, bz] = [D[i * 2], D[i * 2 + 1], D[j * 2], D[j * 2 + 1]];
    const y0 = deckTop;
    const y1 = up(TERMINAL.deckM + 1.05);
    wall.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
  }
  const parapet = new THREE.BufferGeometry();
  parapet.setAttribute("position", new THREE.Float32BufferAttribute(wall, 3));
  parapet.computeVertexNormals();
  parts.push([parapet, "#e6e2d9"]);
  // Piers on a 16 m grid wherever the deck is wide enough to stand on them.
  const step = 16 * M;
  for (let x = x0 + step / 2; x < x1; x += step) {
    for (let z = z0 + step / 2; z < z1; z += step) {
      const inside = [
        [0, 0],
        [3, 0],
        [-3, 0],
        [0, 3],
        [0, -3],
      ].every(([dx, dz]) => pointInPoly(D, x + dx * M, z + dz * M));
      if (!inside) continue;
      const p = box(1.4, TERMINAL.deckM - 1.3, 1.4, 0, (TERMINAL.deckM - 1.3) / 2, 0);
      p.scale(M, M * V, M);
      p.translate(x, floor, z);
      parts.push([p, "#c9c4b9"]);
    }
  }
  // The canopies, each along its longest side.
  for (const c of TERMINAL.canopies) {
    const r = c.ring;
    const k = r.length / 2;
    let best = 0;
    let ux = 1;
    let uz = 0;
    for (let i = 0; i < k; i++) {
      const j = (i + 1) % k;
      const dx = r[j * 2] - r[i * 2];
      const dz = r[j * 2 + 1] - r[i * 2 + 1];
      const l = Math.hypot(dx, dz);
      if (l > best) [best, ux, uz] = [l, dx / l, dz / l];
    }
    let [a0, a1, b0, b1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < k; i++) {
      const a = r[i * 2] * ux + r[i * 2 + 1] * uz;
      const b = -r[i * 2] * uz + r[i * 2 + 1] * ux;
      [a0, a1, b0, b1] = [Math.min(a0, a), Math.max(a1, a), Math.min(b0, b), Math.max(b1, b)];
    }
    const len = (a1 - a0) / M;
    const wid = (b1 - b0) / M;
    const ca = (a0 + a1) / 2;
    const cb = (b0 + b1) / 2;
    const cx = ca * ux - cb * uz;
    const cz = ca * uz + cb * ux;
    const tilt = 0.16;
    const valley = c.top - 1.4;
    const g: [THREE.BufferGeometry, string][] = [];
    for (const side of [-1, 1]) {
      const wing = box(len, 0.35, wid / 2 + 0.6, 0, 0, 0);
      wing.rotateX(-side * tilt); // (the outer edge up)
      wing.translate(0, valley + (wid / 4) * Math.sin(tilt), (side * wid) / 4);
      g.push([wing, "#eeece6"]);
      const panel = box(len - 1, 0.12, wid / 2 - 0.6, 0, 0, 0);
      panel.rotateX(-side * tilt);
      panel.translate(0, valley - 0.35 + (wid / 4) * Math.sin(tilt), (side * wid) / 4);
      g.push([panel, "#c4302b"]);
    }
    const posts = Math.max(2, Math.round(len / 12) + 1);
    for (let i = 0; i < posts; i++) {
      const a = -len / 2 + 3 + ((len - 6) * i) / (posts - 1);
      g.push([box(0.7, valley - TERMINAL.deckM, 0.7, a, (valley + TERMINAL.deckM) / 2, 0), "#eeece6"]);
    }
    for (const [geo] of g) {
      geo.scale(M, M * V, M);
      geo.rotateY(-Math.atan2(uz, ux));
      geo.translate(cx, floor, cz);
    }
    parts.push(...g);
  }
  const geo = painted(parts);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

// --- the gates -----------------------------------------------------------------------------------

/** A stand: where the nose stops (8 m off the concourse) and the way it points. */
interface Stand {
  x: number;
  z: number;
  heading: number;
  /** nose direction (x, z) */
  fx: number;
  fz: number;
}

const STANDS: Stand[] = GATES.map(([lon, lat, deg]) => {
  const [gx, gz] = project(lon, lat);
  const h = THREE.MathUtils.degToRad(deg);
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  return { x: gx - fx * 0.008, z: gz - fz * 0.008, heading: h, fx, fz };
});

const BRIDGE = new THREE.Color("#ffffff");

/** Jet bridges: from the concourse wall out to each parked aircraft's forward door, on a leg. */
function bridgeMesh(ground: HeightField, stands: Stand[]): THREE.Mesh {
  const tube = box(3.4, 3.2, 15, 0, 4.4, 0);
  const leg = box(1.2, 2.8, 1.2, 0, 1.4, 3.5);
  const cab = box(4.2, 3.6, 3.2, 0, 4.4, 8.4);
  const one = merge([tube, leg, cab]);
  const mesh = instanced(one, new THREE.MeshLambertMaterial({ color: "#d4d6d8" }), stands.length);
  stands.forEach((st, i) => {
    // Along the aircraft's left side, from the wall (8 m ahead of the nose) back to its door.
    const lx = st.fz;
    const lz = -st.fx;
    const cx = st.x + st.fx * 0.0005 + lx * 0.0052;
    const cz = st.z + st.fz * 0.0005 + lz * 0.0052;
    _quat.setFromAxisAngle(_up, -st.heading);
    _m.compose(_p.set(cx, groundY(ground, cx, cz), cz), _quat, _s.setScalar(M));
    mesh.setMatrixAt(i, _m);
    mesh.setColorAt(i, BRIDGE);
  });
  mesh.count = stands.length;
  mesh.castShadow = true;
  return mesh;
}

interface Mover {
  script: Script;
  /** seconds into its script */
  t: number;
  livery: Livery;
}

interface Sim {
  body: THREE.InstancedMesh;
  wings: THREE.InstancedMesh;
  fin: THREE.InstancedMesh;
  lights: THREE.Points;
  movers: Mover[];
  /** the stands with an aircraft at them; they're the first instances */
  parked: Stand[];
  /** the size parked aircraft were last drawn at */
  parkedBoost: number;
  ground: HeightField;
}

const MOVERS = 6;

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

/** Draw the parked aircraft at a size: larger from further out, growing from the nose (which
 * stays at its stand). */
function placeParked(sim: Sim, boost: number) {
  sim.parkedBoost = boost;
  const k = PARKED * boost;
  // The nose is 29.25 m ahead of the centre at full scale.
  const back = 0.02925 * k;
  sim.parked.forEach((st, i) => {
    const x = st.x - st.fx * back;
    const z = st.z - st.fz * back;
    _quat.setFromAxisAngle(_up, -st.heading);
    _m.compose(_p.set(x, groundY(sim.ground, x, z) + 0.0024 * SCALE * k, z), _quat, _s.setScalar(k));
    for (const part of [sim.body, sim.wings, sim.fin]) part.setMatrixAt(i, _m);
  });
  for (const part of [sim.body, sim.wings, sim.fin]) part.instanceMatrix.needsUpdate = true;
}

/** How much larger aircraft are drawn: true size up close, up to half as large again from afar. */
const zoomBoost = (dist: number) => 1 + 0.5 * THREE.MathUtils.clamp((dist - 2.2) / 5, 0, 1);

function makeSim(ground: HeightField): { root: THREE.Group; parked: Stand[] } {
  const geo = planeGeometry();
  const white = () => new THREE.MeshLambertMaterial({ color: "#ffffff" });
  // Most gates busy.
  const rnd = mulberry(7);
  const parked = STANDS.filter(() => rnd() < 0.85);
  const n = parked.length + MOVERS;
  const body = instanced(geo.body, white(), n);
  const wings = instanced(geo.wings, white(), n);
  const fin = instanced(geo.fin, white(), n);
  body.castShadow = wings.castShadow = fin.castShadow = true;
  // Each airline at a run of neighbouring gates, as at a real terminal, west to east.
  const order = parked.map((_, i) => i).sort((p, q) => parked[p].x - parked[q].x);
  const total = LIVERIES.reduce((t, l) => t + l.share, 0);
  const runs = [...LIVERIES].reverse();
  let li = 0;
  let used = 0;
  order.forEach((i, k) => {
    while (li < runs.length - 1 && (k / order.length) * total >= used + runs[li].share) used += runs[li++].share;
    body.setColorAt(i, runs[li].body);
    wings.setColorAt(i, WING);
    fin.setColorAt(i, runs[li].fin);
  });
  body.count = wings.count = fin.count = n;

  const arr = arrival(ground);
  const dep = departure(ground);
  const movers: Mover[] = [];
  // Staggered so there is usually one on final, one rolling and one climbing out.
  for (let k = 0; k < MOVERS / 2; k++) {
    movers.push({ script: arr, t: (arr.duration * k) / (MOVERS / 2), livery: anyLivery(rnd()) });
    movers.push({ script: dep, t: (dep.duration * (k + 0.5)) / (MOVERS / 2), livery: anyLivery(rnd()) });
  }
  movers.forEach((m, k) => {
    const i = parked.length + k;
    body.setColorAt(i, m.livery.body);
    wings.setColorAt(i, WING);
    fin.setColorAt(i, m.livery.fin);
  });

  const lightGeo = new THREE.BufferGeometry();
  lightGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array((MOVERS * 4 + 1) * 3), 3));
  lightGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array((MOVERS * 4 + 1) * 3), 3));
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
  root.add(body, wings, fin, lights);
  const sim: Sim = { body, wings, fin, lights, movers, parked, parkedBoost: 0, ground };
  root.userData.sim = sim;
  placeParked(sim, 1);
  return { root, parked };
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

interface Built {
  sim: THREE.Group;
  shared: SharedPaint;
  cab: THREE.Mesh;
  beacon: THREE.Vector3;
}

export default function Airport({ ground, normal }: { ground: HeightField; normal: THREE.Texture }) {
  const ref = useRef<THREE.Group>(null);
  const root = useMemo(() => {
    const shared = sharedUniforms(normal);
    const { root: sim, parked } = makeSim(ground);
    const tower = towerMeshes(ground);
    const group = new THREE.Group();
    group.add(
      runwayMesh(ground, shared),
      leadInMesh(ground, shared),
      tower.solid,
      tower.cab,
      bridgeMesh(ground, parked),
      solarMesh(ground),
      yellowGarageMesh(ground),
      terminalMesh(ground),
      landsideMesh(ground),
      sim,
    );
    group.userData.built = { sim, shared, cab: tower.cab, beacon: tower.beacon } satisfies Built;
    return group;
  }, [ground, normal]);

  useFrame((state, dt) => {
    const g = ref.current;
    if (!g) return;
    const built = g.userData.built as Built;
    const cam = runtime.cam;
    updatePaint(built.shared, state.camera as THREE.PerspectiveCamera, cam.dist, state.size.height, state.gl.getPixelRatio());
    const night = sky.uNight.value;
    (built.cab.material as THREE.MeshLambertMaterial).emissiveIntensity = THREE.MathUtils.smoothstep(night, 0.3, 0.8) * 0.9;
    // The aircraft only when the airport could be in view: close enough, or its approach overhead.
    const near = Math.hypot(cam.x - AIRPORT[0], cam.z - (AIRPORT[1] - 4)) < 12 + cam.dist * 0.9;
    built.sim.visible = near;
    if (!near) return;
    const sim = built.sim.userData.sim as Sim;
    const zoom = zoomBoost(cam.dist);
    if (Math.abs(zoom - sim.parkedBoost) > 0.01) placeParked(sim, zoom);
    const step = runtime.reducedMotion ? 0 : Math.min(dt, 0.1);
    const lp = sim.lights.geometry.attributes.position as THREE.BufferAttribute;
    const lc = sim.lights.geometry.attributes.color as THREE.BufferAttribute;
    const blink = Math.sin(sky.uTime.value * 5.5) > 0.6 ? 1 : 0;
    const base = sim.parked.length;
    sim.movers.forEach((m, k) => {
      m.t = (m.t + step) % m.script.duration;
      const [size, landing] = sample(sim, m.script, m.t, _p, _q);
      const i = base + k;
      const dx = _q.x - _p.x;
      const dz = _q.z - _p.z;
      const dy = _q.y - _p.y;
      const heading = Math.atan2(dx, -dz);
      const pitch = Math.atan2(dy, Math.hypot(dx, dz) || 1e-6);
      _quat.setFromEuler(_e.set(pitch, -heading, 0, "YXZ"));
      // Larger from further out, and more so in the air, so an approach still reads from downtown.
      const airborne = THREE.MathUtils.smoothstep(_p.y - groundY(sim.ground, _p.x, _p.z), 0.01, 0.08);
      const boost = zoom * (1 + airborne * THREE.MathUtils.clamp((cam.dist - 2.5) / 5, 0, 1.2) * 0.8);
      _m.compose(_p, _quat, _s.setScalar(Math.max(1e-4, size * boost)));
      for (const part of [sim.body, sim.wings, sim.fin]) part.setMatrixAt(i, _m);
      // Lights: landing light ahead of the nose, the beacon, and the wingtips.
      const fx = Math.sin(heading);
      const fz = -Math.cos(heading);
      const span = 0.017 * SCALE * size * boost;
      const put = (j: number, x: number, y: number, z: number, c: THREE.Color, on: number) => {
        lp.setXYZ(k * 4 + j, x, y, z);
        lc.setXYZ(k * 4 + j, c.r * on, c.g * on, c.b * on);
      };
      put(0, _p.x + fx * 0.02, _p.y, _p.z + fz * 0.02, WHITE, landing * size * 1.4);
      put(1, _p.x, _p.y + 0.004, _p.z, RED, blink * size);
      put(2, _p.x + fz * span, _p.y, _p.z - fx * span, RED, size * 0.8);
      put(3, _p.x - fz * span, _p.y, _p.z + fx * span, GREEN, size * 0.8);
    });
    // The tower's red obstruction light.
    const tb = built.beacon;
    lp.setXYZ(MOVERS * 4, tb.x, tb.y, tb.z);
    lc.setXYZ(MOVERS * 4, RED.r * (0.4 + 0.6 * blink), RED.g * (0.4 + 0.6 * blink), RED.b * (0.4 + 0.6 * blink));
    for (const part of [sim.body, sim.wings, sim.fin]) part.instanceMatrix.needsUpdate = true;
    lp.needsUpdate = true;
    lc.needsUpdate = true;
    const lm = sim.lights.material as THREE.PointsMaterial;
    lm.opacity = THREE.MathUtils.smoothstep(night, 0.25, 0.7);
    lm.size = 3 + (1 - sky.uZoomOut.value) * 3;
    sim.lights.visible = lm.opacity > 0.01;
  });

  return <primitive ref={ref} object={root} />;
}
