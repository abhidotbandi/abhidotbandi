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
};

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
    if (plan.kind === "factory") return factory(kit, f, wall, roof);
    return office(kit, f, plan.kind === "glass", wall, roof);
  });
  if (plan.docks) docks(kit, fps[0], [plan.docks[0], plan.docks[1]], plan.docks[2] ?? 0.6);
  plan.props?.(kit, s, fps, tops, ground);
  return true;
}
