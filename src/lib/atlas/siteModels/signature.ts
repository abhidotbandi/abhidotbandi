import * as THREE from "three";
import type { SiteRef } from "@/data/atlas/companies";
import { groundY, type HeightField } from "../geo";
import {
  C,
  GLOW,
  V,
  at,
  box,
  building,
  cap,
  cyl,
  distToRing,
  docks,
  drum,
  headingOf,
  offset,
  place,
  pointInRing,
  roofGrid,
  rooftopUnits,
  slab,
  strut,
  type Band,
  type Footprint,
  type Kit,
} from "./kit";

// The signature sites, each modelled on its own: Giga Texas under its solar roof, Samsung's and
// NXP's fabs with their cooling towers and gas yards, Firefly's Rocket Ranch, and the Starlink
// factory and The Boring Company's tunnelling yard at Bastrop.

// --- Giga Texas ------------------------------------------------------------------------------

/**
 * Tesla's T as solar arrays: the thin arc on top, the bar (an arch, thickest in the middle and
 * tapering to points) and, below a narrow gap, the stem narrowing downwards. x and y in -1..1.
 */
function teslaT(): number[][] {
  const N = 18;
  const arc = (x: number) => 0.99 - 0.14 * x * x;
  const barTop = (x: number) => 0.87 - 0.15 * x * x;
  const barBottom = (x: number) => barTop(x) - 0.24 * (1 - Math.pow(Math.abs(x) / 0.94, 2.5));
  const xs = (a: number, i: number) => -a + (2 * a * i) / N;
  const thin: number[] = [];
  for (let i = 0; i <= N; i++) thin.push(xs(0.98, i), arc(xs(0.98, i)));
  for (let i = N; i >= 0; i--) thin.push(xs(0.98, i), arc(xs(0.98, i)) - 0.06);
  const bar: number[] = [];
  for (let i = 0; i <= N; i++) bar.push(xs(0.94, i), barTop(xs(0.94, i)));
  for (let i = N - 1; i >= 1; i--) bar.push(xs(0.94, i), barBottom(xs(0.94, i)));
  const stem: number[] = [];
  for (let i = 0; i <= 6; i++) stem.push(xs(0.16, (i * N) / 6), barBottom(xs(0.16, (i * N) / 6)) - 0.055);
  stem.push(0.1, -1.0, -0.1, -1.0);
  return [thin, bar, stem];
}

export function gigaTexas(kit: Kit, fps: Footprint[]) {
  const [hall, ...rest] = fps;
  // The hall's sections are mapped as footprints of their own too: the hall covers them.
  for (const f of rest) {
    if (pointInRing(hall.ring, f.cx, f.cz)) continue;
    const top = building(kit, f, [[f.hM - 1, C.wall], [1, C.wall, GLOW.accent]], C.roof);
    rooftopUnits(kit, f, top);
  }
  const H = hall.hM;
  const top = building(
    kit,
    hall,
    [
      [5, C.plinth],
      [H * 0.68 - 5, C.wall],
      [H * 0.15, C.glass, GLOW.windows],
      [H * 0.17 - 0.9, C.wall],
      [0.9, C.wall, GLOW.accent],
    ],
    C.roof,
  );
  const hd = headingOf(hall);
  const L = hall.a * 1000;
  const W = hall.b * 1000;
  // Solar arrays over the ends of the roof, and the T between them, top to the north.
  const logoHalf = 140;
  for (let p = -L + 36; p <= L - 36; p += 46) {
    if (Math.abs(p) < logoHalf + 25) continue;
    for (let q = -W + 23; q <= W - 23; q += 22) {
      const [x, z] = at(hall, p, q);
      if (pointInRing(hall.ring, x, z) && distToRing(hall.ring, x, z) * 1000 > 24) {
        kit.part(box(40, 0.8, 18), C.solar, place(x, top, z, hd), GLOW.solar);
      }
    }
  }
  const s = hall.uz > 0 ? -1 : 1; // the axis points south: north is -p
  for (const shape of teslaT()) {
    slab(kit, shape, (x, y) => at(hall, s * y * 140, s * x * 125), top, 0.9, C.solar, GLOW.solar);
  }
  // Plant along the long sides.
  for (let p = -L + 30; p <= L - 30; p += 32) {
    for (const q of [-W + 9, W - 9]) {
      const [x, z] = at(hall, p, q);
      if (pointInRing(hall.ring, x, z)) kit.part(box(8, 2.6, 5), C.unit, place(x, top, z, hd));
    }
  }
}

// --- Samsung's fabs --------------------------------------------------------------------------

export interface FabPlan {
  /** metres east and north of the site point: the building whose roof carries the cooling towers */
  cub: [number, number];
  /** the gas yard, if there is one: metres east and north of the site point, heading (degrees) */
  yard?: [number, number, number];
  /** heights (m) for the largest footprints, where the map has none */
  heights?: number[];
  /** walls and roofs, if not white */
  wall?: string;
  roof?: string;
}

export const FABS: Record<string, FabPlan> = {
  samsung: { cub: [106, -257], yard: [88, -360, 28] },
  "samsung-taylor": { cub: [140, -238], yard: [390, -200, 9], heights: [40, 26, 30, 28] },
  // NXP's fabs date from Motorola's day, in tan precast.
  "nxp-oak-hill": { cub: [178, 398], yard: [232, 415, 0], wall: C.precast, roof: C.precastRoof },
  "nxp-ed-bluestein": { cub: [-187, -255], yard: [-120, -284, 0], wall: C.precast, roof: C.precastRoof },
};

function fabRoof(kit: Kit, f: Footprint, top: number) {
  const hd = headingOf(f);
  roofGrid(f, 34, 26, 12).forEach(([p, q], k) => {
    const [x, z] = at(f, p, q);
    const m = place(x, top, z, hd);
    if ((k + (Math.round(p / 34) & 1)) % 3 === 0) {
      // Exhaust stacks, in pairs.
      kit.part(cyl(1.3, 1.3, 10, -3, 0, 0, 10), C.stack, m);
      kit.part(cyl(1.3, 1.3, 10, 3, 0, 0, 10), C.stack, m);
    } else {
      kit.part(box(14, 4.5, 7), C.unit, m);
    }
  });
}

function coolingTowers(kit: Kit, f: Footprint, top: number, steam: number[]) {
  const hd = headingOf(f);
  const n = Math.max(1, Math.min(8, Math.floor((f.a * 2000 - 24) / 15)));
  // Two rows where the roof is wide enough, one down the middle where it isn't.
  const rows = f.b * 1000 >= 16 ? [-8, 8] : [0];
  for (let i = 0; i < n; i++) {
    for (const q of rows) {
      const [x, z] = at(f, (i - (n - 1) / 2) * 15, q);
      const m = place(x, top, z, hd);
      kit.part(box(13.5, 5, 13.5), C.towerBody, m);
      kit.part(cyl(5.4, 5.8, 3.4, 0, 5, 0, 16), C.towerShroud, m);
      kit.part(cyl(4.9, 4.9, 0.3, 0, 8.1, 0, 16), C.fan, m);
      steam.push(x, top + 8.6 * V, z);
    }
  }
}

/** Bulk gases: air-separation columns and the cold box, storage tanks, tube trailers' drums. */
function gasYard(kit: Kit, ground: HeightField, x: number, z: number, heading: number) {
  const m = place(x, groundY(ground, x, z) - 0.001, z, heading);
  kit.part(box(28, 1.4, 44), C.concrete, m);
  for (const cz of [-14, -5]) {
    kit.part(cyl(1.9, 1.9, 46, -8, 1, cz), C.tank, m);
    kit.part(cyl(2.7, 2.7, 0.5, -8, 30, cz), C.steel, m);
    kit.part(box(0.9, 0.9, 0.9, -8, 47, cz), C.dark, m, GLOW.beacon);
  }
  kit.part(box(5, 30, 6, -8, 1, 7), C.tankShade, m);
  for (const cz of [-15, -7, 1, 9]) {
    kit.part(cyl(2.8, 2.8, 15, 3, 1, cz), C.tank, m);
    kit.part(cap(2.8, 1.4, 3, 16, cz), C.tank, m);
  }
  for (const cx of [9.5, 12.5]) kit.part(drum(1.3, 14, cx, 2.6, 8), C.tankShade, m);
  kit.clearRect(x, z, 34, 50, heading);
}

export function fab(kit: Kit, fps: Footprint[], s: SiteRef, plan: FabPlan, ground: HeightField, steam: number[]) {
  const [cx, cz] = offset(s, ...plan.cub);
  let cub = fps[0];
  for (const f of fps) if (Math.hypot(f.cx - cx, f.cz - cz) < Math.hypot(cub.cx - cx, cub.cz - cz)) cub = f;
  fps.forEach((f, i) => {
    if (fps.some((g) => g !== f && g.areaM2 > f.areaM2 && pointInRing(g.ring, f.cx, f.cz))) return;
    const h = plan.heights?.[i] ?? f.hM;
    const wall = plan.wall ?? C.fabWall;
    const office = f.areaM2 < 4000;
    const bands: Band[] = office
      ? [
          [h * 0.5, wall],
          [2.2, C.glass, GLOW.windows],
          [h * 0.5 - 3.2, wall],
          [1, wall, GLOW.accent],
        ]
      : [
          [h - 3.4, wall],
          [1.4, wall, GLOW.accent],
          [2, wall],
        ];
    const top = building(kit, f, bands, plan.roof ?? C.fabRoof);
    if (f === cub) coolingTowers(kit, f, top, steam);
    else if (f.areaM2 > 8000) fabRoof(kit, f, top);
    else rooftopUnits(kit, f, top, 24);
  });
  if (plan.yard) {
    const [yx, yz] = offset(s, plan.yard[0], plan.yard[1]);
    gasYard(kit, ground, yx, yz, (plan.yard[2] * Math.PI) / 180);
  }
}

// --- Firefly's Rocket Ranch ------------------------------------------------------------------

/** The stage test stand: a steel tower over a flame trench, with a first stage in it. */
function stageStand(kit: Kit, ground: HeightField, x: number, z: number) {
  const m = place(x, groundY(ground, x, z) - 0.001, z);
  const H = 44;
  const s = 6;
  kit.part(box(26, 1.5, 26), C.concrete, m);
  kit.part(box(8, 0.2, 12, 0, 1.5, 0), C.dark, m);
  kit.part(box(18, 2.4, 10, 17, 0, 0), C.concrete, m); // the flame deflector's run to the east
  const legs: [number, number][] = [
    [-s, -s],
    [s, -s],
    [s, s],
    [-s, s],
  ];
  for (const [lx, lz] of legs) kit.part(box(0.9, H - 1.5, 0.9, lx, 1.5, lz), C.steel, m);
  for (let y = 1.5; y + 6 <= H + 0.1; y += 6) {
    for (let i = 0; i < 4; i++) {
      const [ax, az] = legs[i];
      const [bx, bz] = legs[(i + 1) % 4];
      kit.part(strut([ax, y + 6, az], [bx, y + 6, bz], 0.5), C.steel, m);
      kit.part(strut([ax, y, az], [bx, y + 6, bz], 0.35), C.steel, m);
    }
  }
  kit.part(box(15, 0.8, 15, 0, H, 0), C.steel, m);
  kit.part(box(1, 7, 1, 5, H + 0.8, -5), C.steel, m);
  kit.part(box(12, 0.8, 0.8, 0, H + 7, -5), C.steel, m); // the jib that lifts stages in
  kit.part(cyl(1.0, 1.0, 22, 0, 6, 0, 16), C.rocket, m);
  kit.part(cyl(1.04, 1.04, 1.6, 0, 26.5, 0, 16), C.black, m);
  kit.part(box(0.9, 0.9, 0.9, 5, H + 7.8, -5), C.dark, m, GLOW.beacon);
  for (const [px, pz] of [
    [-17, -17],
    [17, 17],
    [-17, 17],
  ]) {
    kit.part(box(0.5, 20, 0.5, px, 0, pz), C.steel, m);
    kit.part(box(2.4, 1.2, 1.2, px, 20, pz), C.dark, m, GLOW.lamp);
  }
  kit.clearRect(x + 0.004, z, 44, 40);
}

/** A horizontal engine stand firing east; returns the nozzle's exit (world, km). */
function engineStand(kit: Kit, ground: HeightField, x: number, z: number): THREE.Vector3 {
  // Drawn a size up, as the figures are, so the stand reads from the tour's distance.
  const K = 1.4;
  const m = place(x, groundY(ground, x, z) - 0.001, z, 0, K);
  kit.part(box(34, 0.8, 16, 4, 0, 0), C.concrete, m);
  kit.part(box(6, 10, 12, -9, 0.8, 0), C.concrete, m); // thrust block
  for (const fx of [-5, 3]) for (const fz of [-3, 3]) kit.part(box(0.6, 8, 0.6, fx, 0.8, fz), C.steel, m);
  for (const fz of [-3, 3]) kit.part(box(8.6, 0.6, 0.6, -1, 8.8, fz), C.steel, m);
  for (const fx of [-5, 3]) kit.part(box(0.6, 0.6, 6.6, fx, 8.8, 0), C.steel, m);
  const engine = new THREE.CylinderGeometry(0.8, 0.8, 3, 12, 1);
  engine.rotateZ(Math.PI / 2);
  engine.translate(-2, 5.8, 0);
  kit.part(engine, C.dark, m);
  const bell = new THREE.CylinderGeometry(0.35, 1.2, 2.4, 14, 1, true);
  bell.rotateZ(-Math.PI / 2);
  bell.translate(0.7, 5.8, 0);
  kit.part(bell, C.steel, m);
  for (const fz of [-5.5, 5.5]) kit.part(cyl(1.6, 1.6, 10, -14, 0.8, fz), C.tank, m);
  for (const [px, pz] of [
    [10, -9],
    [10, 9],
  ]) {
    kit.part(box(0.4, 12, 0.4, px, 0.8, pz), C.steel, m);
    kit.part(box(1.6, 0.9, 0.9, px, 12.8, pz), C.dark, m, GLOW.lamp);
  }
  kit.clearRect(x + 0.004, z, 60, 30);
  return new THREE.Vector3(1.9, 5.8, 0).applyMatrix4(m);
}

/** Propellant: a LOX tank, kerosene drums, and a run tank. */
function tankFarm(kit: Kit, ground: HeightField, x: number, z: number) {
  const m = place(x, groundY(ground, x, z) - 0.001, z);
  kit.part(box(46, 0.8, 36), C.concrete, m);
  kit.part(cyl(4.2, 4.2, 16, -12, 0.8, -6, 16), C.tank, m);
  kit.part(cap(4.2, 2.4, -12, 16.8, -6, 16), C.tank, m);
  for (const dz of [-8, 4]) {
    kit.part(drum(2.2, 18, 8, 3.4, dz), C.tankShade, m);
    kit.part(box(5, 1.4, 1, 8, 0.8, dz - 6), C.concrete, m);
    kit.part(box(5, 1.4, 1, 8, 0.8, dz + 6), C.concrete, m);
  }
  kit.part(cyl(3, 3, 14, -12, 0.8, 10, 14), C.tank, m);
  kit.clearRect(x, z, 50, 40);
}

function waterTower(kit: Kit, ground: HeightField, x: number, z: number) {
  const m = place(x, groundY(ground, x, z) - 0.001, z);
  for (const [lx, lz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    kit.part(strut([lx * 4.5, 0, lz * 4.5], [lx * 3, 28, lz * 3], 0.6), C.steel, m);
  }
  kit.part(cyl(6.5, 6.5, 7, 0, 28, 0, 16), C.tank, m);
  kit.part(cyl(0.4, 6.8, 2.6, 0, 35, 0, 16), C.tankShade, m);
  kit.part(box(0.8, 0.8, 0.8, 0, 37.6, 0), C.dark, m, GLOW.beacon);
  kit.clearRect(x, z, 16, 16);
}

/** The control bunker, bermed on the side facing the stands. */
function bunker(kit: Kit, ground: HeightField, x: number, z: number, heading: number) {
  const m = place(x, groundY(ground, x, z) - 0.001, z, heading);
  kit.part(box(24, 5, 12), C.concrete, m);
  kit.part(box(28, 3.2, 7, 0, 0, -9), C.earth, m);
  kit.part(box(8, 1.2, 1.6, 4, 5, 2), C.unit, m);
  kit.clearRect(x, z, 32, 26, heading);
}

export function rocketRanch(kit: Kit, fps: Footprint[], s: SiteRef, ground: HeightField): THREE.Vector3 {
  for (const f of fps) building(kit, f, [[f.hM - 1.2, C.shedWall], [1.2, C.shedWall, GLOW.accent]], C.shedRoof);
  // The test area, in the open east of the ranch's shop buildings.
  stageStand(kit, ground, ...offset(s, 470, -120));
  const nozzle = engineStand(kit, ground, ...offset(s, 450, -250));
  tankFarm(kit, ground, ...offset(s, 545, -180));
  waterTower(kit, ground, ...offset(s, 400, -60));
  bunker(kit, ground, ...offset(s, 420, -315), (20 * Math.PI) / 180);
  return nozzle;
}

// --- Starlink, Bastrop -----------------------------------------------------------------------

export function starlink(kit: Kit, fps: Footprint[]) {
  fps.forEach((f, i) => {
    const h = f.hM;
    if (i > 0) {
      building(kit, f, [[h * 0.45, C.wall], [2, C.glass, GLOW.windows], [h * 0.55 - 3, C.wall], [1, C.wall, GLOW.accent]], C.roof);
      return;
    }
    const top = building(
      kit,
      f,
      [
        [3.5, C.plinthLight],
        [h - 6, C.wall],
        [1.3, C.black],
        [1.2, C.wall, GLOW.accent],
      ],
      C.roof,
    );
    rooftopUnits(kit, f, top, 32);
    // Skylights between the units, lit from inside after dark.
    for (const [p, q] of roofGrid(f, 32, 25.6, 24)) {
      const [x, z] = at(f, p + 16, q + 12.8);
      if (pointInRing(f.ring, x, z) && distToRing(f.ring, x, z) * 1000 > 14) {
        kit.part(box(18, 0.6, 3), C.glass, place(x, top, z, headingOf(f)), GLOW.windows);
      }
    }
    // Loading docks on the side facing the truck court, trailers backed up to them.
    docks(kit, f, [1, -1]);
  });
}

// --- The Boring Company, Bastrop ---------------------------------------------------------------

/** A tunnel boring machine staged on cradles: cutterhead east, shield, trailing gantries. */
function boringMachine(kit: Kit, ground: HeightField, x: number, z: number) {
  const m = place(x, groundY(ground, x, z) - 0.001, z);
  const lying = (r: number, len: number, cx: number, y: number, seg = 16, open = false) => {
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, open);
    g.rotateZ(Math.PI / 2);
    g.translate(cx, y, 0);
    return g;
  };
  for (const cx of [-24, -8, 8, 24]) kit.part(box(2, 1, 5, cx, 0, 0), C.concrete, m);
  kit.part(lying(2.15, 0.8, 32.6, 3), C.dark, m); // cutterhead
  kit.part(lying(2.2, 0.5, 32, 3), C.yellow, m);
  kit.part(lying(2, 12, 26, 3), C.steel, m); // shield
  for (const cx of [12, -2, -16]) {
    kit.part(box(12, 3.4, 3.6, cx, 1, 0), C.machine, m); // trailing gantries
    kit.part(box(3, 1, 1.6, cx - 3, 4.4, 0), C.yellow, m);
  }
  kit.clearRect(x, z, 72, 14);
}

/** Tunnel-lining rings stacked in a yard under a gantry crane. */
function segmentYard(kit: Kit, ground: HeightField, x: number, z: number) {
  const m = place(x, groundY(ground, x, z) - 0.001, z);
  kit.part(box(44, 0.3, 32), C.concrete, m);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      const g = new THREE.CylinderGeometry(2.1, 2.1, 1.3 * (2 + ((i + j) % 2)), 16, 1, true);
      g.translate(-14 + i * 9, 0.3 + (1.3 * (2 + ((i + j) % 2))) / 2, -9 + j * 9);
      kit.part(g, C.concrete, m);
    }
  }
  for (const lx of [-19, 19]) for (const lz of [-14, 14]) kit.part(box(1, 12, 1, lx, 0.3, lz), C.yellow, m);
  for (const lz of [-14, 14]) kit.part(box(39, 1.4, 1.4, 0, 12.3, lz), C.yellow, m);
  kit.part(box(1.6, 1.6, 30, 4, 13.7, 0), C.yellow, m);
  kit.part(box(2, 1.5, 2, 4, 9, 0), C.dark, m);
  kit.clearRect(x, z, 48, 36);
}

export function boringCompany(kit: Kit, fps: Footprint[], s: SiteRef, ground: HeightField) {
  for (const f of fps) {
    const top = building(kit, f, [[3, C.plinth], [f.hM - 4.2, C.metalWall], [1.2, C.metalWall, GLOW.accent]], C.roof);
    rooftopUnits(kit, f, top, 26);
  }
  // Beside the factory, clear of Snailbrook's houses: a machine to the north, rings to the east.
  boringMachine(kit, ground, ...offset(s, 20, 225));
  segmentYard(kit, ground, ...offset(s, 110, 110));
}
