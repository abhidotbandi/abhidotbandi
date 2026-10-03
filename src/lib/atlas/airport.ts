import { project } from "./geo";

// Austin-Bergstrom International, from Overture (base/infrastructure and buildings): what the
// airport's scene (scene/Airport.tsx) draws itself, so the detail tiles leave it out.

export interface Runway {
  /** thresholds (scene km), north and south */
  n: [number, number];
  s: [number, number];
  /** designators painted at each end, read from the approach */
  north: [string, string];
  south: [string, string];
}

/** 17R/35L to the west (12,250 ft), 17L/35R to the east (9,000 ft). [number, side] per end. */
export const RUNWAYS: Runway[] = [
  { n: project(-97.67938, 30.21358), s: project(-97.67848, 30.17997), north: ["17", "R"], south: ["35", "L"] },
  { n: project(-97.65791, 30.20381), s: project(-97.65726, 30.17913), north: ["17", "L"], south: ["35", "R"] },
];

/** Half a runway's width (150 ft), km. */
export const RUNWAY_HALF = 0.02286;

/** The airfield (scene km: x0, z0, x1, z1): the detail tiles draw no runways in it. */
const [AX0, AZ0] = project(-97.69, 30.222);
const [AX1, AZ1] = project(-97.645, 30.17);
export const inAirfield = (x: number, z: number) => x > AX0 && x < AX1 && z > AZ0 && z < AZ1;

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
