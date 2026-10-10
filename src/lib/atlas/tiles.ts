// Detail tiles: everything the always-loaded map leaves out (every other building, local
// streets, paths, runways, parking lots and pools), in 2 km squares loaded around the camera.
// Built by scripts/atlas/build_tiles.py, which documents the layout.

import { decodeBuildings, type BuildingsData } from "./buildingsCodec";

export interface TileIndex {
  /** tile edge, km */
  size: number;
  /** scene x, z (km) of tile (0, 0)'s north-west corner */
  origin: [number, number];
  nx: number;
  nz: number;
  /** [ix, iz, bytes, buildings] per tile that has anything in it */
  tiles: [number, number, number, number][];
}

export interface TileData {
  buildings: BuildingsData;
  /** open polylines; `height` holds the street class (STREETS) */
  streets: BuildingsData;
  /** polygons; `height` holds the area kind (AREAS) */
  areas: BuildingsData;
}

const MAGIC = 0x4c495441; // "ATIL", little-endian

export function decodeTile(buf: ArrayBuffer): TileData {
  const dv = new DataView(buf);
  if (buf.byteLength < 20 || dv.getUint32(0, true) !== MAGIC || dv.getUint8(4) !== 1) {
    throw new Error("tile: not an atlas tile, or an unsupported version");
  }
  const lens = [dv.getUint32(8, true), dv.getUint32(12, true), dv.getUint32(16, true)];
  let at = 20;
  const [buildings, streets, areas] = lens.map((n) => {
    const part = decodeBuildings(buf.slice(at, at + n));
    at += n;
    return part;
  });
  return { buildings, streets, areas };
}

export interface StreetStyle {
  /** half width, metres */
  half: number;
  /** 0 street, 1 track or path (unpaved look), 2 arterial, 3 runway, 4 taxiway */
  look: number;
  /** streetlight spacing after dark, metres (0: none) */
  lamps: number;
}

/** Street classes, by the codes in build_tiles.py's STREET_CODES. */
export const STREETS: Record<number, StreetStyle> = {
  1: { half: 4.5, look: 0, lamps: 38 }, // residential
  2: { half: 4, look: 0, lamps: 0 }, // unclassified
  3: { half: 3.5, look: 0, lamps: 30 }, // living street
  4: { half: 3, look: 0, lamps: 0 }, // service
  5: { half: 2.5, look: 0, lamps: 0 }, // alley
  6: { half: 3, look: 0, lamps: 0 }, // parking aisle
  7: { half: 2, look: 1, lamps: 0 }, // track
  8: { half: 1.2, look: 0, lamps: 0 }, // footway
  9: { half: 1, look: 1, lamps: 0 }, // path
  10: { half: 1.5, look: 0, lamps: 0 }, // cycleway
  11: { half: 3, look: 0, lamps: 24 }, // pedestrian
  20: { half: 6, look: 2, lamps: 34 }, // tertiary
  21: { half: 7, look: 2, lamps: 32 }, // secondary
  22: { half: 8.5, look: 2, lamps: 30 }, // primary
  23: { half: 11, look: 2, lamps: 30 }, // trunk
  24: { half: 14, look: 2, lamps: 40 }, // motorway
  30: { half: 22.5, look: 3, lamps: 0 }, // runway
  31: { half: 11.5, look: 4, lamps: 0 }, // taxiway
};

/** Inside central Austin, roads come as lanes for cars only (not drawn), coded class + this. */
export const LANES_ONLY = 100;

export interface CarClass {
  /** km/s */
  speed: number;
  /** traffic per km of road, relative */
  weight: number;
  /** lanes each way (on one-way carriageways: in all) */
  lanes: number;
  /** motorways and trunks come as one line per carriageway, digitised in the direction of travel */
  oneWay: boolean;
}

/** The streets cars drive on, by street class. */
export const CARS: Record<number, CarClass> = {
  1: { speed: 0.0085, weight: 0.3, lanes: 1, oneWay: false },
  2: { speed: 0.009, weight: 0.25, lanes: 1, oneWay: false },
  3: { speed: 0.005, weight: 0.1, lanes: 1, oneWay: false },
  20: { speed: 0.011, weight: 1.2, lanes: 1, oneWay: false },
  21: { speed: 0.013, weight: 1.8, lanes: 2, oneWay: false },
  22: { speed: 0.015, weight: 2.4, lanes: 2, oneWay: false },
  23: { speed: 0.02, weight: 3, lanes: 2, oneWay: true },
  24: { speed: 0.026, weight: 4, lanes: 3, oneWay: true },
};

/** Area kinds, by build_tiles.py's AREA_* codes. */
export const AREA_PARKING = 1;
export const AREA_APRON = 2;
export const AREA_HELIPAD = 3;
/** Bare ground on a building site. */
export const AREA_SITE = 5;
export const AREA_POOL = 10;
export const AREA_POND = 11;
/** As drawn (detail/build.ts): an apron of asphalt rather than concrete... */
export const AREA_APRON_ASPHALT = 4;
/** ...and a car park as this plus the heading of its rows (degrees counterclockwise from east,
 * 0 to 180), so its stalls are laid out along them, plus PHASE_STEP_KIND for every PHASE_STEP_M
 * its rows are shifted across (0 to 18 m), so its aisles fall on the ones mapped there. */
export const AREA_PARKING_ROWS = 100;
export const PHASE_STEP_KIND = 200;
export const PHASE_STEP_M = 0.5;
