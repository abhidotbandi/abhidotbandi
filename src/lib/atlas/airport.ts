import { project } from "./geo";

// Austin-Bergstrom International, from Overture (base/infrastructure and buildings) and USGS
// imagery (public domain): what the airport's scene (scene/Airport.tsx) draws itself, so the
// detail tiles leave it out, and what the terrain and the tiles draw differently there.

export interface Runway {
  /** thresholds (scene km), north and south */
  n: [number, number];
  s: [number, number];
  /** designators painted at each end, read from the approach */
  north: [string, string];
  south: [string, string];
  /** paved shoulder either side of the 150 ft runway, m */
  shoulder: number;
  /** blast pads beyond the north and south thresholds (Overture's stopways), m */
  padN: number;
  padS: number;
}

/**
 * 17R/35L to the west (12,250 ft), 17L/35R to the east (9,000 ft). [number, side] per end. The
 * west runway was Bergstrom Air Force Base's, 300 ft wide for its B-52s: it's marked at 150 ft
 * now, the rest paved shoulder.
 */
export const RUNWAYS: Runway[] = [
  {
    n: project(-97.67938, 30.21358),
    s: project(-97.67848, 30.17997),
    north: ["17", "R"],
    south: ["35", "L"],
    shoulder: 23,
    padN: 310,
    padS: 307,
  },
  {
    n: project(-97.65791, 30.20381),
    s: project(-97.65726, 30.17913),
    north: ["17", "L"],
    south: ["35", "R"],
    shoulder: 5,
    padN: 125,
    padS: 125,
  },
];

/** Half a runway's width (150 ft), km. */
export const RUNWAY_HALF = 0.02286;

/** The old parallel runway in the west infield, closed (yellow X's down it): not in the map
 * data, traced from USGS imagery. Its ends (scene km) and half its width (km). */
export const CLOSED_RUNWAY = {
  n: project(-97.67588, 30.2058),
  s: project(-97.67526, 30.1808),
  half: 0.0225,
};

/** The airfield (scene km: x0, z0, x1, z1): the detail tiles draw no runways in it. */
const [AX0, AZ0] = project(-97.69, 30.222);
const [AX1, AZ1] = project(-97.645, 30.17);
export const inAirfield = (x: number, z: number) => x > AX0 && x < AX1 && z > AZ0 && z < AZ1;

/** The airfield's boundary (Overture's, to 20 m): lon, lat. The terrain lays mown turf in it. */
const FIELD_LL: [number, number][] = [
  [-97.66214, 30.16993],
  [-97.65932, 30.16756],
  [-97.652, 30.17295],
  [-97.64778, 30.17826],
  [-97.64724, 30.17939],
  [-97.64602, 30.18404],
  [-97.64818, 30.19302],
  [-97.64678, 30.19438],
  [-97.65162, 30.19845],
  [-97.64424, 30.2049],
  [-97.66032, 30.21314],
  [-97.66712, 30.2172],
  [-97.67151, 30.21945],
  [-97.67216, 30.21843],
  [-97.67327, 30.21898],
  [-97.67424, 30.21813],
  [-97.67926, 30.21803],
  [-97.68039, 30.21768],
  [-97.68262, 30.21906],
  [-97.68249, 30.2174],
  [-97.68302, 30.21629],
  [-97.68272, 30.21128],
  [-97.6831, 30.20373],
  [-97.68253, 30.20344],
  [-97.68231, 30.20272],
  [-97.68274, 30.20216],
  [-97.68331, 30.19813],
  [-97.68328, 30.19709],
  [-97.6824, 30.19463],
  [-97.68233, 30.18997],
  [-97.68197, 30.18962],
  [-97.68196, 30.17829],
  [-97.6802, 30.17649],
  [-97.67767, 30.17595],
  [-97.66856, 30.17263],
];
export const FIELD: [number, number][] = FIELD_LL.map(([lon, lat]) => project(lon, lat));
const FX = FIELD.map((p) => p[0]);
const FZ = FIELD.map((p) => p[1]);
const [FX0, FX1, FZ0, FZ1] = [Math.min(...FX), Math.max(...FX), Math.min(...FZ), Math.max(...FZ)];

/** How far inside the airfield's boundary (x, z) is, km (0 outside it). */
export function insideField(x: number, z: number): number {
  if (x < FX0 || x > FX1 || z < FZ0 || z > FZ1) return 0;
  let inside = false;
  let d = Infinity;
  for (let i = 0, j = FIELD.length - 1; i < FIELD.length; j = i++) {
    const [ax, az] = FIELD[j];
    const [bx, bz] = FIELD[i];
    if (bz > z !== az > z && x < ((ax - bx) * (z - bz)) / (az - bz) + bx) inside = !inside;
    const ex = bx - ax;
    const ez = bz - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    d = Math.min(d, Math.hypot(ax + ex * t - x, az + ez * t - z));
  }
  return inside ? d : 0;
}

/** The cargo and general aviation aprons on the east side are asphalt, not concrete. */
const [GX0, GZ0] = project(-97.6655, 30.1912);
const [GX1, GZ1] = project(-97.6603, 30.179);
export const asphaltApron = (x: number, z: number) => x > GX0 && x < GX1 && z > GZ0 && z < GZ1;

/**
 * The control tower. The map has it, its base building and an annex as one 69.5 m footprint
 * (centred at `site`): the tiles leave that out, and the scene builds them apart: the shaft on
 * the octagon at the footprint's south corner, the base and annex as blocks turned 43° (centre
 * x, z km, length and width m, along their long side).
 */
export const TOWER = {
  site: project(-97.66578, 30.19627),
  shaft: project(-97.665625, 30.196106),
  base: { at: [7.4386, 7.8365], l: 53, w: 35.6 },
  annex: { at: [7.4111, 7.8666], l: 24.2, w: 17.3 },
  /** heading of the blocks' long sides: radians from +x toward +z */
  turn: (43.4 * Math.PI) / 180,
  heightM: 69.5,
};

/**
 * A solar array: rows of panels along a heading, in blocks, either on posts over a car park or on
 * a garage's roof, `height` m up (as its building is drawn). Blocks are m along the heading and
 * to its left (looking down, north up) from `origin`; rows repeat every `pitch` m across them,
 * `gap` m apart.
 */
export interface SolarArray {
  origin: [number, number];
  /** unit vectors in the scene: along the rows, and to their left */
  along: [number, number];
  left: [number, number];
  blocks: [number, number, number, number][];
  pitch: number;
  gap: number;
  height: number;
  /** on posts (casting shadows on the cars below), not on a roof */
  canopy: boolean;
}

function solar(
  lon: number,
  lat: number,
  /** degrees counterclockwise from east */
  heading: number,
  blocks: SolarArray["blocks"],
  rows: { pitch: number; gap: number; height: number; canopy: boolean },
): SolarArray {
  const a = (heading * Math.PI) / 180;
  // (Scene z runs south.)
  return { origin: project(lon, lat), along: [Math.cos(a), -Math.sin(a)], left: [-Math.sin(a), -Math.cos(a)], blocks, ...rows };
}

/**
 * Solar canopies over the car park beside Highway 71 (traced from USGS imagery: eight blocks over
 * a 317 by 243 m lot), and the panels over the top decks of the terminal's two garages: the Blue
 * Garage's rows run east-west, the Red Garage's north-south.
 */
export const SOLAR: SolarArray[] = [
  solar(
    -97.662351,
    30.214561,
    -42.7,
    [
      [29, -238, 87, -197],
      [222, -240, 306, -197],
      [28, -188, 86, -115],
      [98, -188, 213, -115],
      [222, -191, 318, -115],
      [34, -105, 86, -22],
      [98, -107, 213, -2],
      [224, -108, 318, -1],
    ],
    { pitch: 13, gap: 1.2, height: 4.5, canopy: true },
  ),
  solar(-97.67, 30.20524, 0, [[4, -111, 278, -4]], { pitch: 7, gap: 2.4, height: 4.7, canopy: false }),
  solar(-97.66861, 30.20405, -90, [[4, 4, 113, 313]], { pitch: 7, gap: 2.4, height: 13.9, canopy: false }),
];

/**
 * Gate stands at the Barbara Jordan Terminal (Overture's airport_gate points on the concourse's
 * edge, thinned where two stands share a spot): lon, lat, and the way an aircraft parked there
 * points its nose (degrees clockwise from north, square to the concourse).
 */
export const GATES: [number, number, number][] = [
  [-97.662695, 30.202471, 269],
  [-97.662815, 30.202564, 179],
  [-97.662752, 30.202057, 359],
  [-97.663233, 30.202479, 179],
  [-97.663326, 30.202053, 359],
  [-97.663825, 30.202041, 0],
  [-97.664108, 30.20253, 179],
  [-97.664777, 30.202427, 179],
  [-97.664883, 30.202174, 0],
  [-97.665777, 30.201916, 344],
  [-97.666174, 30.201821, 348],
  [-97.666626, 30.20175, 354],
  [-97.667261, 30.201729, 359],
  [-97.667713, 30.201778, 8],
  [-97.668203, 30.201883, 18],
  [-97.668622, 30.202047, 35],
  [-97.669416, 30.202344, 179],
  [-97.669402, 30.202082, 359],
  [-97.669892, 30.202334, 179],
  [-97.669857, 30.202074, 359],
  [-97.670422, 30.202324, 179],
  [-97.670411, 30.202064, 359],
  [-97.670887, 30.202314, 179],
  [-97.670879, 30.202056, 359],
  [-97.671289, 30.202398, 179],
  [-97.671368, 30.201901, 359],
  [-97.671545, 30.202307, 89],
];
