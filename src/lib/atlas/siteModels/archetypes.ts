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
  cyl,
  distToRing,
  docks,
  headingOf,
  offset,
  place,
  pointInRing,
  roofGrid,
  rooftopUnits,
  strut,
  unboost,
  type Band,
  type Footprint,
  type Kit,
} from "./kit";
import { fab, type FabPlan } from "./signature";

// Every other company site, by the kind of place it is: offices in curtain-wall glass or with
// punched windows, labs with ribbon windows and fume stacks, factories with skylights and loading
// docks, and fabs with the kit Samsung's and NXP's have. Where one plausibly stands, a prop says
// what the company makes.

type Kind = "office" | "glass" | "lab" | "factory" | "fab";

interface Plan {
  kind: Kind;
  wall?: string;
  roof?: string;
  /** factories: the side (east, north) the loading docks face, and the share with a trailer */
  docks?: [number, number, number?];
  fab?: FabPlan;
  /** extras, given the site, its footprints and their roofs (world y, NaN where not built) */
  props?: (kit: Kit, s: SiteRef, fps: Footprint[], tops: number[], ground: HeightField) => void;
}

/** A mechanical penthouse in the middle of a roof, if it fits; returns the height it reaches. */
function penthouse(kit: Kit, f: Footprint, top: number, h = 4.5): number {
  const a = Math.min(f.a * 450, 22);
  const b = Math.min(f.b * 450, 12);
  if (a < 5 || b < 4) return top;
  const corners: [number, number][] = [
    [-a, -b],
    [a, -b],
    [a, b],
    [-a, b],
  ];
  if (!corners.every(([p, q]) => pointInRing(f.ring, ...at(f, p, q)))) return top;
  kit.part(box(a * 2, h, b * 2), C.unit, place(f.ox, top, f.oz, headingOf(f)));
  return top + h * V;
}

function office(kit: Kit, f: Footprint, glass: boolean, wall: string, roof: string): number {
  const h = Math.max(5, f.hM);
  const bands: Band[] = glass
    ? [
        [h - 1.1, C.curtain, GLOW.windows],
        [1.1, wall, GLOW.accent],
      ]
    : [
        [1.2, C.plinth],
        [h - 2.3, wall, GLOW.punched],
        [1.1, wall, GLOW.accent],
      ];
  const top = building(kit, f, bands, roof);
  if (!(h > 14 && penthouse(kit, f, top) > top)) rooftopUnits(kit, f, top, 24);
  return top;
}

/** Ribbon windows floor by floor, over a plinth and under a parapet in the site's colour. */
function ribbons(h: number, wall: string): Band[] {
  const n = Math.max(1, Math.round((h - 2.2) / 4.2));
  const fh = (h - 2.2) / n;
  const out: Band[] = [[1, C.plinth]];
  for (let i = 0; i < n; i++) out.push([fh * 0.45, wall], [fh * 0.55, C.glass, GLOW.windows]);
  out.push([1.2, wall, GLOW.accent]);
  return out;
}

function lab(kit: Kit, f: Footprint, wall: string, roof: string): number {
  const top = building(kit, f, ribbons(Math.max(5, f.hM), wall), roof);
  if (penthouse(kit, f, top, 4) > top) {
    // Fume-hood exhausts in a row beside the penthouse.
    const n = Math.max(2, Math.min(6, Math.floor((f.a * 1000) / 10)));
    const q = Math.min(f.b * 450, 12) + 3;
    for (let i = 0; i < n; i++) {
      const [x, z] = at(f, (i - (n - 1) / 2) * 6, q);
      if (pointInRing(f.ring, x, z)) kit.part(cyl(0.45, 0.45, 7, 0, 0, 0, 8), C.stack, place(x, top, z));
    }
  } else {
    rooftopUnits(kit, f, top, 22);
  }
  return top;
}

/**
 * A glass office front across the end of a factory nearest its address (usually the street),
 * standing a little proud of the walls and roof. Only on footprints that fill their box.
 */
function officeFront(kit: Kit, f: Footprint, s: SiteRef, h: number) {
  const L = f.a * 1000;
  const W = f.b * 1000;
  if (f.areaM2 / (4 * L * W) < 0.85 || L < 25) return;
  const sign = Math.hypot(...sub(at(f, L, 0), s)) < Math.hypot(...sub(at(f, -L, 0), s)) ? 1 : -1;
  const [x, z] = at(f, sign * (L - 4.4), 0);
  // From 2 m below the lowest corner to ~1.5 m over the roof (vertical metres are boosted).
  kit.part(box(10, h + 2.2, Math.min(2 * W + 0.6, 40)), C.curtain, place(x, f.y0 - 0.002, z, headingOf(f)), GLOW.windows);
}

const sub = ([x, z]: [number, number], s: SiteRef): [number, number] => [x - s.x, z - s.z];

function factory(kit: Kit, f: Footprint, wall: string, roof: string): number {
  const h = Math.max(5, f.hM);
  const top = building(
    kit,
    f,
    [
      [1.2, C.plinth],
      [h - 2.4, wall],
      [1.2, wall, GLOW.accent],
    ],
    roof,
  );
  const hd = headingOf(f);
  rooftopUnits(kit, f, top, 30);
  // Skylights between the units, lit from inside after dark.
  for (const [p, q] of roofGrid(f, 30, 24, 20)) {
    const [x, z] = at(f, p + 15, q + 12);
    if (pointInRing(f.ring, x, z) && distToRing(f.ring, x, z) * 1000 > 12) {
      kit.part(box(16, 0.6, 3), C.glass, place(x, top, z, hd), GLOW.windows);
    }
  }
  return top;
}

// --- Props -------------------------------------------------------------------------------------

/** Autonomous boats on road trailers, side by side, bows east. */
function boats(kit: Kit, ground: HeightField, x: number, z: number, n: number) {
  // A size up, as the figures are, so they read from a street's distance.
  const m = place(x, groundY(ground, x, z) - 0.001, z, 0, 1.2);
  kit.part(box(14, 0.3, (n - 1) * 5 + 8), C.concrete, m); // the yard's pad
  for (let i = 0; i < n; i++) {
    const zc = (i - (n - 1) / 2) * 5;
    kit.part(box(8.5, 0.35, 2.2, 0, 0.55, zc), C.dark, m); // trailer
    kit.part(box(1.1, 0.75, 2.5, -1.2, 0, zc), C.dark, m); // axle
    kit.part(box(2.2, 0.2, 0.25, 5.2, 0.6, zc), C.dark, m); // tongue
    kit.part(box(5.6, 1.1, 2.4, -0.6, 0.9, zc), C.hull, m);
    // The bow: a triangular prism, one corner forward.
    const bow = new THREE.CylinderGeometry(1.39, 1.39, 1.1, 3, 1);
    bow.rotateY(Math.PI / 2);
    bow.translate(2.89, 1.45, zc);
    kit.part(bow, C.hull, m);
    kit.part(box(1.9, 1, 1.7, -1.2, 2, zc), C.cabin, m);
    kit.part(box(0.18, 1.6, 0.18, -1.4, 3, zc), C.dark, m); // sensor mast
    kit.part(box(0.7, 0.35, 0.7, -1.4, 4.6, zc), C.radome, m);
  }
  kit.clearRect(x, z, 22, 34);
}

/** The site's footprint nearest a point (metres east and north of the site point). */
function nearest(fps: Footprint[], s: SiteRef, e: number, n: number): number {
  const [x, z] = offset(s, e, n);
  let best = 0;
  fps.forEach((f, i) => {
    if (Math.hypot(f.cx - x, f.cz - z) < Math.hypot(fps[best].cx - x, fps[best].cz - z)) best = i;
  });
  return best;
}

/** A dish antenna r metres in radius on a pedestal, tipped up `elev` toward `heading`. */
function dish(kit: Kit, x: number, y: number, z: number, r: number, heading: number, elev: number) {
  const m = place(x, y, z, heading);
  kit.part(cyl(r * 0.1, r * 0.16, r * 1.1, 0, 0, 0, 10), C.truss, m);
  // A shallow cap turned to open upwards, tipped over, and kept round against the boost.
  const R = r / Math.sin(0.5);
  const g = new THREE.SphereGeometry(R, 18, 4, 0, Math.PI * 2, 0, 0.5);
  g.scale(1, -1, 1);
  g.translate(0, R, 0);
  g.rotateZ(-(Math.PI / 2 - elev));
  unboost(g);
  g.translate(0, r * 1.1, 0);
  kit.part(g, C.radome, m);
}

/** A radome r metres in radius on a low ring. */
function radome(kit: Kit, x: number, y: number, z: number, r: number) {
  const m = place(x, y, z);
  kit.part(cyl(r * 0.85, r * 0.9, 1.2, 0, 0, 0, 14), C.concrete, m);
  const g = unboost(new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62));
  g.translate(0, 1.2 + (r * 0.37) / 1.6, 0);
  kit.part(g, C.radome, m);
}

/** A square lattice mast h metres tall with panel antennas and a red light on top. */
function mast(kit: Kit, x: number, y: number, z: number, h: number, w = 3) {
  const m = place(x, y, z);
  const legs: [number, number][] = [
    [-w / 2, -w / 2],
    [w / 2, -w / 2],
    [w / 2, w / 2],
    [-w / 2, w / 2],
  ];
  for (const [lx, lz] of legs) kit.part(box(0.35, h, 0.35, lx, 0, lz), C.steel, m);
  for (let yy = 0; yy + 4 <= h + 0.1; yy += 4) {
    for (let i = 0; i < 4; i++) {
      const [ax, az] = legs[i];
      const [bx, bz] = legs[(i + 1) % 4];
      kit.part(strut([ax, yy, az], [bx, yy + 4, bz], 0.18), C.steel, m);
    }
  }
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    kit.part(box(0.4, 2.4, 1, Math.cos(a) * (w / 2 + 0.4), h - 3, Math.sin(a) * (w / 2 + 0.4)), C.white, m);
  }
  kit.part(box(0.6, 0.6, 0.6, 0, h, 0), C.dark, m, GLOW.beacon);
}

/** A landing pad on legs above the rooftop plant, with a VTOL drone on it. */
function dronePad(kit: Kit, x: number, y: number, z: number, heading: number) {
  const m = place(x, y, z, heading);
  for (const [lx, lz] of [
    [-5, -5],
    [5, -5],
    [5, 5],
    [-5, 5],
  ]) {
    kit.part(box(0.4, 3.2, 0.4, lx, 0, lz), C.steel, m);
  }
  kit.part(cyl(7.4, 7.4, 0.35, 0, 3.2, 0, 24), C.yellow, m);
  kit.part(cyl(6.6, 6.6, 0.4, 0, 3.2, 0, 24), C.cabin, m);
  // A fixed-wing VTOL, a size up: fuselage, wing, lift-rotor booms, tail.
  const d = place(x, y, z, heading, 1.6);
  kit.part(box(3.2, 0.6, 0.6, 0, 2.3, 0), C.white, d);
  kit.part(box(0.9, 0.12, 5.2, 0.2, 2.6, 0), C.white, d);
  for (const bz of [-1.4, 1.4]) {
    kit.part(box(3.6, 0.15, 0.15, 0, 2.6, bz), C.dark, d);
    for (const bx of [-1.6, 1.6]) kit.part(cyl(0.8, 0.8, 0.05, bx, 2.75, bz, 12), C.dark, d);
  }
  kit.part(box(0.5, 0.8, 0.1, -1.5, 2.6, 0), C.white, d);
}

/** Air-cooled chillers in two rows on a pad, fans up. */
function chillers(kit: Kit, ground: HeightField, x: number, z: number, n: number) {
  const m = place(x, groundY(ground, x, z) - 0.001, z);
  kit.part(box(n * 6.5 + 3, 0.4, 14), C.concrete, m);
  for (let i = 0; i < n; i++) {
    for (const zz of [-3.4, 3.4]) {
      const cx = (i - (n - 1) / 2) * 6.5;
      kit.part(box(6, 2.6, 5.4, cx, 0.4, zz), C.metalLight, m);
      for (const fx of [-1.5, 1.5]) kit.part(cyl(1.1, 1.1, 0.2, cx + fx, 3, zz, 12), C.fan, m);
    }
  }
  kit.clearRect(x, z, n * 6.5 + 5, 16);
}

/** A reactor vessel on a low trailer, and a container beside it. */
function reactorVessel(kit: Kit, ground: HeightField, x: number, z: number) {
  const m = place(x, groundY(ground, x, z) - 0.001, z);
  kit.part(box(20, 0.3, 10), C.concrete, m);
  kit.part(box(13, 0.9, 3.2, -2, 0.3, 0), C.dark, m);
  const vessel = new THREE.CylinderGeometry(1.9, 1.9, 9, 18, 1);
  vessel.rotateZ(Math.PI / 2);
  vessel.translate(-2, 3.1, 0);
  kit.part(vessel, C.steel, m);
  kit.part(box(12.2, 2.6, 2.4, 1, 0.3, 3.4), C.white, m);
  kit.clearRect(x, z, 22, 12);
}

/** Generators in container-sized enclosures, lined up for shipping. */
function generatorUnits(kit: Kit, ground: HeightField, x: number, z: number, n: number) {
  const m = place(x, groundY(ground, x, z) - 0.001, z);
  kit.part(box(14, 0.3, (n - 1) * 4 + 4), C.concrete, m);
  for (let i = 0; i < n; i++) {
    const zc = (i - (n - 1) / 2) * 4;
    kit.part(box(12.2, 2.9, 2.5, 0, 0.3, zc), C.white, m);
    kit.part(box(1.2, 0.8, 1.2, 3.5, 3.2, zc), C.stack, m);
    kit.part(box(0.1, 2.6, 2.3, 6.15, 0.45, zc), C.door, m);
  }
  kit.clearRect(x, z, 16, (n - 1) * 4 + 6);
}

/** A small process skid: tanks and a pipe rack. */
function pilotPlant(kit: Kit, ground: HeightField, x: number, z: number) {
  const m = place(x, groundY(ground, x, z) - 0.001, z);
  kit.part(box(14, 0.3, 10), C.concrete, m);
  for (const [tx, tz] of [
    [-4, -2.5],
    [-1, -2.5],
    [2, -2.5],
    [5, -2.5],
  ]) {
    kit.part(cyl(1.2, 1.2, 5.5, tx, 0.3, tz), C.tank, m);
  }
  kit.part(box(12, 0.3, 0.3, 0.5, 4.2, 1.2), C.steel, m);
  for (const px of [-5, 0.5, 6]) kit.part(box(0.25, 4, 0.25, px, 0.3, 1.2), C.steel, m);
  kit.part(box(4, 2.4, 2.4, -3, 0.3, 3), C.metalLight, m);
  kit.clearRect(x, z, 16, 12);
}

/** A construction printer's gantry over a small house it's printing, walls in layers. */
function printerYard(kit: Kit, ground: HeightField, x: number, z: number) {
  const m = place(x, groundY(ground, x, z) - 0.001, z);
  kit.part(box(18, 0.25, 14), C.concrete, m);
  // The walls so far, 2.4 m up, with a door and a window left open.
  const W = 11;
  const D = 8;
  const t = 0.45;
  kit.part(box(W, 2.4, t, 0, 0.25, -D / 2), C.printed, m);
  kit.part(box(t, 2.4, D, -W / 2, 0.25, 0), C.printed, m);
  kit.part(box(t, 2.4, D, W / 2, 0.25, 0), C.printed, m);
  kit.part(box(4, 2.4, t, -3.5, 0.25, D / 2), C.printed, m);
  kit.part(box(4.5, 2.4, t, 3.25, 0.25, D / 2), C.printed, m);
  kit.part(box(1.5, 1.2, t, -0.75 + 0.25, 0.25, D / 2), C.printed, m); // under the window
  // Rails either side, a tower on each, the bridge between and the print head on it.
  for (const rz of [-6, 6]) {
    kit.part(box(16, 0.3, 0.4, 0, 0.25, rz), C.steel, m);
    kit.part(strut([-1.4, 0.3, rz], [0, 4.6, rz], 0.35), C.truss, m);
    kit.part(strut([1.4, 0.3, rz], [0, 4.6, rz], 0.35), C.truss, m);
  }
  kit.part(box(0.8, 0.8, 12.8, 0, 4.6, 0), C.truss, m);
  kit.part(box(0.9, 1.6, 0.9, 0, 3.1, 1.5), C.dark, m);
  kit.clearRect(x, z, 20, 16);
}

/** Home batteries on pallets, in rows, waiting to ship. */
function batteryPallets(kit: Kit, ground: HeightField, x: number, z: number, rows: number, cols: number) {
  const m = place(x, groundY(ground, x, z) - 0.001, z);
  kit.part(box(cols * 2 + 2, 0.25, rows * 2.4 + 2), C.concrete, m);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = (c - (cols - 1) / 2) * 2;
      const pz = (r - (rows - 1) / 2) * 2.4;
      kit.part(box(1.3, 0.15, 1.1, px, 0.25, pz), C.pallet, m);
      kit.part(box(1.1, 1.3, 0.8, px, 0.4, pz), C.white, m);
    }
  }
  kit.clearRect(x, z, cols * 2 + 4, rows * 2.4 + 4);
}

// --- Plans -------------------------------------------------------------------------------------

export const PLANS: Record<string, Plan> = {
  // Semiconductor equipment made in cleanrooms: the fab kit's rooftop plant and cooling towers,
  // without a bulk-gas yard.
  "applied-materials": { kind: "fab", fab: { cub: [-19, 120] } },
  // Autonomous surface vessels, built here: finished boats wait on their trailers in the yard.
  saronic: {
    kind: "factory",
    docks: [0.6, 0.8, 0.5],
    props: (kit, s, _fps, _tops, ground) => boats(kit, ground, ...offset(s, 90, 90), 4),
  },
  // Fabs: SkyWater's Fab 25 and the Montopolis research fab.
  skywater: { kind: "fab", fab: { cub: [165, 51], yard: [174, -29, 0] } },
  tie: { kind: "fab", fab: { cub: [79, -36], yard: [208, 16, 0] } },
  // Factories.
  "allen-control-systems": { kind: "factory", wall: C.metalLight },
  "allen-control-systems-factory": { kind: "factory" },
  "aeon-industrial": { kind: "factory", wall: C.metalLight },
  "last-energy": { kind: "factory" },
  infinitum: { kind: "factory" },
  apptronik: { kind: "factory", wall: C.metalLight },
  "fox-robotics": { kind: "factory", docks: [0.7, 0.7, 0] },
  // Spacecraft lines and mission control: a dish on the roof.
  firefly: {
    kind: "factory",
    wall: C.metalLight,
    props: (kit, s, fps, tops) => {
      const i = nearest(fps, s, 86, 131);
      const [x, z] = at(fps[i], fps[i].a * 1000 * 0.55, 0);
      if (!Number.isNaN(tops[i])) dish(kit, x, tops[i], z, 3.2, Math.PI * 0.75, 0.75);
    },
  },
  // A reactor factory: a vessel on its trailer outside.
  aalo: { kind: "factory", props: (kit, s, _fps, _tops, ground) => reactorVessel(kit, ground, ...offset(s, 66, 43)) },
  // Generators, built here, in container-sized enclosures.
  hyliion: { kind: "factory", props: (kit, s, _fps, _tops, ground) => generatorUnits(kit, ground, ...offset(s, 120, -60), 4) },
  // Printed houses: the printer's gantry over walls going up.
  icon: { kind: "factory", props: (kit, s, _fps, _tops, ground) => printerYard(kit, ground, ...offset(s, 22, 22)) },
  // Labs.
  "bae-systems": { kind: "lab", wall: C.precast },
  nanohmics: { kind: "lab" },
  "canon-nanotechnologies": { kind: "lab" },
  energyx: { kind: "lab", props: (kit, s, _fps, _tops, ground) => pilotPlant(kit, ground, ...offset(s, 38, 34)) },
  // Satellite communications: radomes and a mast on the roof.
  cesiumastro: {
    kind: "lab",
    props: (kit, s, fps, tops) => {
      const i = nearest(fps, s, -9, -49);
      if (Number.isNaN(tops[i])) return;
      const f = fps[i];
      const L = f.a * 1000;
      radome(kit, ...xyz(at(f, -L * 0.5, 0), tops[i]), 2.2);
      radome(kit, ...xyz(at(f, -L * 0.2, 0), tops[i]), 1.6);
      mast(kit, ...xyz(at(f, L * 0.45, 0), tops[i]), 9, 1.6);
    },
  },
  // The Pickle Research Campus: radomes on two roofs and an antenna mast.
  "arl-ut": {
    kind: "lab",
    props: (kit, s, fps, tops, ground) => {
      for (const [e, n, r] of [
        [185, 90, 4.5],
        [211, 179, 3.5],
      ]) {
        const i = nearest(fps, s, e, n);
        if (!Number.isNaN(tops[i])) radome(kit, fps[i].ox, tops[i], fps[i].oz, r);
      }
      const [x, z] = offset(s, 60, 130);
      mast(kit, x, groundY(ground, x, z) - 0.001, z, 34);
      kit.clearRect(x, z, 8, 8);
    },
  },
  "ut-csr": {
    kind: "lab",
    props: (kit, s, _fps, _tops, ground) => {
      const [x, z] = offset(s, 94, 24);
      kit.part(box(12, 0.4, 12), C.concrete, place(x, groundY(ground, x, z) - 0.001, z));
      dish(kit, x, groundY(ground, x, z), z, 5, Math.PI * 1.2, 0.6);
      kit.clearRect(x, z, 16, 16);
    },
  },
  // The supercomputers' chillers, in the yard beside the machine room.
  tacc: { kind: "lab", props: (kit, s, _fps, _tops, ground) => chillers(kit, ground, ...offset(s, -55, -41), 4) },
  // Offices.
  // A tilt-wall warehouse in Tower Business Park, fitted out with offices and a fab shop; its
  // drive-in doors face the truck court to the south.
  "perseus-defense": { kind: "factory", docks: [0, -1, 0] },
  "ideal-power": { kind: "office" },
  skyways: {
    kind: "glass",
    props: (kit, s, fps, tops) => {
      const i = nearest(fps, s, 36, 92);
      if (Number.isNaN(tops[i])) return;
      const f = fps[i];
      const [x, z] = at(f, -f.a * 1000 * 0.45, 0);
      dronePad(kit, x, tops[i], z, headingOf(f));
    },
  },
  amd: { kind: "glass" },
  ambiq: { kind: "glass" },
  mythic: { kind: "glass" },
  neurophos: { kind: "glass" },
  ni: { kind: "glass", wall: C.limestone },
  // Central Austin.
  t2com: { kind: "glass" },
  "army-software-factory": { kind: "office", wall: C.limestone },
  "army-applications-lab": { kind: "glass" },
  "silicon-labs": { kind: "glass" },
  "cirrus-logic": { kind: "glass" },
  "diligent-robotics": { kind: "glass" },
  // Home batteries, built in the old Statesman plant: pallets of them wait to ship.
  "base-power": {
    kind: "factory",
    props: (kit, s, _fps, _tops, ground) => batteryPallets(kit, ground, ...offset(s, 70, -20), 4, 8),
  },
};

/** World x, y, z from a ground point (km) and a height. */
const xyz = ([x, z]: [number, number], y: number): [number, number, number] => [x, y, z];
/** Model a planned site; returns whether there was a plan for it. */
export function buildPlanned(kit: Kit, id: string, s: SiteRef, fps: Footprint[], ground: HeightField, steam: number[]): boolean {
  const plan = PLANS[id];
  if (!plan) return false;
  if (plan.kind === "fab" && plan.fab) {
    fab(kit, fps, s, plan.fab, ground, steam);
    plan.props?.(kit, s, fps, [], ground);
    return true;
  }
  const wall = plan.wall ?? (plan.kind === "factory" ? C.tilt : plan.kind === "lab" ? C.limestone : C.stucco);
  const roof = plan.roof ?? C.roof;
  const tops = fps.map((f) => {
    // Sections mapped inside a larger footprint of the site are covered by it.
    if (fps.some((g) => g !== f && g.areaM2 > f.areaM2 && pointInRing(g.ring, f.cx, f.cz))) return Number.NaN;
    if (plan.kind === "lab") return lab(kit, f, wall, roof);
    if (plan.kind === "factory") {
      const top = factory(kit, f, wall, roof);
      if (f === fps[0]) officeFront(kit, f, s, Math.max(5, f.hM));
      return top;
    }
    return office(kit, f, plan.kind === "glass", wall, roof);
  });
  if (plan.docks) docks(kit, fps[0], [plan.docks[0], plan.docks[1]], plan.docks[2] ?? 0.6);
  plan.props?.(kit, s, fps, tops, ground);
  return true;
}
