import { FLAT_ROOFED, TILE_ROOFS_NORTH_OF, UT_CAMPUS, WEST_CAMPUS } from "@/data/atlas/campus";
import { STYLE_CAMPUS_FLAT, STYLE_CAMPUS_TILE, STYLE_WEST_CAMPUS } from "./extrude";
import { project } from "./geo";
import { pointInPoly } from "./polygon";

// Which of central Austin's buildings take a campus style: UT's under red tile hip roofs (not the
// towers, the biggest halls or the ones known to be flat-roofed, and none south of MLK, where the
// medical school's modern towers are), and West Campus's apartment towers.

const ring = (pts: [number, number][]) => Float32Array.from(pts.flatMap(([lon, lat]) => project(lon, lat)));
const CAMPUS = ring(UT_CAMPUS);
const WEST = ring(WEST_CAMPUS);
const NORTH_Z = project(-97.74, TILE_ROOFS_NORTH_OF)[1];
const FLAT = FLAT_ROOFED.map(([lon, lat]) => project(lon, lat));

function bounds(r: Float32Array) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    x0 = Math.min(x0, r[i]);
    x1 = Math.max(x1, r[i]);
    z0 = Math.min(z0, r[i + 1]);
    z1 = Math.max(z1, r[i + 1]);
  }
  return { x0, x1, z0, z1 };
}
const CB = bounds(CAMPUS);
const WB = bounds(WEST);
const inBox = (b: ReturnType<typeof bounds>, x: number, z: number) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;

export function campusStyle(footprint: number[], hM: number, areaM2: number): number {
  let cx = 0;
  let cz = 0;
  const n = footprint.length / 2;
  for (let i = 0; i < n; i++) {
    cx += footprint[i * 2] / n;
    cz += footprint[i * 2 + 1] / n;
  }
  if (inBox(CB, cx, cz) && pointInPoly(CAMPUS, cx, cz)) {
    if (cz > NORTH_Z) return 0;
    const poly = Float32Array.from(footprint);
    const flat = FLAT.some(([x, z]) => pointInPoly(poly, x, z) || Math.hypot(x - cx, z - cz) < 0.035);
    return hM > 40 || areaM2 > 12000 || flat ? STYLE_CAMPUS_FLAT : STYLE_CAMPUS_TILE;
  }
  // West Campus's apartment blocks, from three storeys up (houses keep their pitched roofs).
  if (hM >= 10 && inBox(WB, cx, cz) && pointInPoly(WEST, cx, cz)) return STYLE_WEST_CAMPUS;
  return 0;
}
