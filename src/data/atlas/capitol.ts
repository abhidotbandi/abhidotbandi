// The Texas State Capitol and its grounds (Capitol Square, 11th to 15th Street), for the landmark
// models, the trees and the buildings' styles. Features are placed in the Capitol's own frame:
// (u, v) metres east and north along its axes from its landmark point, the axes turned with the
// downtown street grid. Measured from Overture's footprints, paths, water and places. Points
// outside the frame are [lon, lat].

/** The Capitol's landmark point (as in scripts/atlas/build_central.py). */
export const CAPITOL_ANCHOR: [number, number] = [-97.74035, 30.27472];
/** Its long (east-west) axis, degrees north of east: the street grid's skew (as in the pipeline). */
export const CAPITOL_AXIS_DEG = -17.7;

/** The rotunda, under the dome. The building is symmetric about u = 2. */
export const DOME: [number, number] = [1.8, -5.1];
/** The Great Walk: from the south gate on 11th Street to the foot of the south steps. */
export const GREAT_WALK = { u: 2, from: -213, to: -54, width: 7 };
/** The south steps, up to the portico. */
export const SOUTH_STEPS = { from: -54, to: -42, width: 26 };
/** The two fountains on the south lawn, either side of the Great Walk. */
export const FOUNTAINS: [number, number][] = [
  [-16.5, -131.7],
  [17.7, -131.8],
];
/** The iron fence along 11th Street, and its gates [u, width]: the Great Walk and the two drives. */
export const SOUTH_FENCE = {
  v: -212,
  from: -124,
  to: 132,
  gates: [
    [2, 10],
    [-20.5, 8],
    [24.5, 8],
  ] as [number, number][],
};

/** The Capitol Extension (1993), under the north lawn: its open-air rotunda... */
export const OPEN_ROTUNDA = { u: 2, v: 137, r: 10 };
/** ...and its skylights: centre [u, v], length along u, width along v. */
export const SKYLIGHTS: [number, number, number, number][] = [
  [44.8, 106.6, 37, 7],
  [43.5, 136.8, 39, 11],
  [46.3, 166.2, 37, 8],
  [-42.1, 107.5, 38, 8],
  [-38.9, 137.2, 40, 11],
  [-42.5, 166.9, 38, 8],
  [2.3, 106.5, 5, 31],
  [2.2, 160.5, 5, 17],
];

export type MonumentKind = "column" | "statue" | "rider" | "group" | "wall" | "ring";

/** Monuments on the grounds (Overture places), each drawn in a rough version of its form. */
export const MONUMENTS: { name: string; at: [number, number]; kind: MonumentKind; h: number }[] = [
  { name: "Texas Volunteer Firemen Monument", at: [-97.74104, 30.27318], kind: "column", h: 9 },
  { name: "Confederate Soldiers Monument", at: [-97.74082, 30.27303], kind: "column", h: 14 },
  { name: "Tejano Monument", at: [-97.74034, 30.27283], kind: "group", h: 6 },
  { name: "Texas African American History Memorial", at: [-97.7415, 30.27328], kind: "wall", h: 6 },
  { name: "Texas Cowboy Monument", at: [-97.74146, 30.27411], kind: "rider", h: 5 },
  { name: "Texas Peace Officers' Memorial", at: [-97.73902, 30.27526], kind: "ring", h: 3 },
  { name: "Texas World War II Memorial", at: [-97.74071, 30.27589], kind: "wall", h: 5 },
  { name: "Texas Capitol Vietnam Veterans Monument", at: [-97.73878, 30.27615], kind: "group", h: 4 },
  { name: "Korean War Veterans Memorial", at: [-97.74064, 30.27633], kind: "statue", h: 4 },
];

/** The state's office buildings around the Capitol: a point inside each footprint. */
export const STATE_BUILDINGS: [number, number][] = [
  [-97.74114, 30.27585], // Texas Supreme Court
  [-97.74157, 30.27587], // Tom C. Clark
  [-97.7404, 30.27667], // John H. Reagan
  [-97.73893, 30.27624], // Texas Workforce Commission
  [-97.73785, 30.27598], // Texas Workforce Commission Annex
  [-97.73855, 30.27509], // Sam Houston
  [-97.73845, 30.27389], // Lorenzo de Zavala State Archives and Library
  [-97.73843, 30.27707], // Robert E. Johnson Legislative Office Building
  [-97.73814, 30.27728], // Robert E. Johnson Conference Center
  [-97.74204, 30.27622], // Price Daniel Sr.
  [-97.74223, 30.27809], // William P. Clements Jr.
  [-97.73771, 30.278], // Lyndon B. Johnson
  [-97.73851, 30.27813], // Barbara Jordan
  [-97.738, 30.27905], // William B. Travis
  [-97.73934, 30.27934], // Stephen F. Austin
  [-97.73752, 30.27987], // George H.W. Bush
  [-97.73666, 30.27967], // Employees Retirement System
  [-97.74003, 30.27879], // Capitol Complex North Central Utility Plant
  [-97.73883, 30.27272], // State Insurance
  [-97.73911, 30.27186], // State Insurance Annex
  [-97.73954, 30.27198], // James Earl Rudder
  [-97.73945, 30.27156], // Thomas Jefferson Rusk
  [-97.74023, 30.27217], // Dewitt C. Greer
  [-97.74305, 30.27196], // Ernest O. Thompson
  [-97.73688, 30.2724], // Texas Workforce Commission (Red River)
  [-97.73728, 30.27094], // Teacher Retirement System
];
