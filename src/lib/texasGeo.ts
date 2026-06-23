// Simplified Texas state border, as [longitude, latitude] pairs, traced
// clockwise from the NW Panhandle corner. Approximate — enough to read as
// "Texas" at the scale this site renders it, not survey-accurate.
export const TX_OUTLINE: [number, number][] = [
  [-103.05, 36.5],
  [-100.0, 36.5],
  [-100.0, 34.56],
  [-99.2, 34.2],
  [-98.5, 34.0],
  [-97.5, 33.85],
  [-96.5, 33.85],
  [-95.5, 33.65],
  [-94.5, 33.65],
  [-94.05, 33.02],
  [-94.0, 31.95],
  [-93.85, 31.16],
  [-93.75, 30.32],
  [-93.7, 29.75],
  [-94.8, 29.3],
  [-95.3, 28.95],
  [-96.4, 28.45],
  [-97.05, 27.85],
  [-97.4, 27.2],
  [-97.5, 26.2],
  [-97.15, 25.95],
  [-98.2, 26.4],
  [-99.5, 27.5],
  [-100.5, 28.4],
  [-101.4, 29.3],
  [-102.3, 29.75],
  [-103.1, 29.3],
  [-104.0, 29.4],
  [-104.7, 30.4],
  [-106.2, 31.4],
  [-106.5, 31.78],
  [-106.5, 32.0],
  [-103.05, 32.0],
];

export interface GeoCity {
  id: string;
  name: string;
  lon: number;
  lat: number;
  isFocus?: boolean;
}

export const TEXAS_CITIES_GEO: GeoCity[] = [
  { id: "dallas", name: "Dallas", lon: -96.8, lat: 32.78 },
  { id: "houston", name: "Houston", lon: -95.37, lat: 29.76 },
  { id: "austin", name: "Austin", lon: -97.74, lat: 30.27, isFocus: true },
  { id: "sanantonio", name: "San Antonio", lon: -98.49, lat: 29.42 },
];

export interface GeoSite {
  id: string;
  lon: number;
  lat: number;
  kind: "wind" | "solar" | "plant";
}

// A handful of real ERCOT generation regions, for flavor: West Texas wind
// corridor, Permian/Big Spring solar, and Gulf Coast gas plants.
export const GENERATION_SITES: GeoSite[] = [
  { id: "sweetwater-wind", lon: -100.4, lat: 32.47, kind: "wind" },
  { id: "mcCamey-wind", lon: -102.2, lat: 31.13, kind: "wind" },
  { id: "permian-solar", lon: -102.0, lat: 32.0, kind: "solar" },
  { id: "gulf-plant", lon: -95.05, lat: 29.4, kind: "plant" },
];

const TX_CENTER = { lon: -99.5, lat: 31.0 };
const TX_SCALE = 0.55;

/** Equirectangular-ish projection centered on Texas, north = +z. */
export function projectLonLat(lon: number, lat: number): [number, number] {
  const cosLat = Math.cos((TX_CENTER.lat * Math.PI) / 180);
  const x = (lon - TX_CENTER.lon) * cosLat * TX_SCALE;
  const z = (lat - TX_CENTER.lat) * TX_SCALE;
  return [x, z];
}
