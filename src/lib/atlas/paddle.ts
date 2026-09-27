// Paddle Lady Bird Lake: the route down the lake from Red Bud Isle to Longhorn Dam, and the
// places and bridges passed on the way.

import { PLACES } from "@/data/atlas/places";
import type { Central } from "./central";
import { project } from "./geo";
import { Path, nearestIndex } from "./paths";

/** Seconds for the whole journey at normal speed. */
export const PADDLE_SECONDS = 150;

export interface Waypoint {
  name: string;
  /** 0..1 along the route */
  s: number;
  kind: "place" | "bridge";
  placeId?: string;
}

export interface PaddleRoute {
  path: Path;
  waypoints: Waypoint[];
}

/** Display names for the road bridges the route passes under. */
const BRIDGE_NAMES: Record<string, string> = {
  "South Mopac Expressway": "MoPac bridge",
  "South Lamar Boulevard": "Lamar Boulevard bridge",
  "Pfluger Pedestrian Bridge": "Pfluger Pedestrian Bridge",
  "South 1st Street": "South 1st Street bridge",
  "South Interstate 35": "I-35 bridge",
};

/** Distance along a polyline (km) to its nearest point to (x, z), and how far off it is. */
function project1(path: Path, x: number, z: number): { d: number; off: number } {
  const p = path.pts;
  const n = p.length / 2;
  let best = { d: 0, off: Infinity };
  for (let i = 0; i + 1 < n; i++) {
    const ax = p[i * 2];
    const az = p[i * 2 + 1];
    const dx = p[i * 2 + 2] - ax;
    const dz = p[i * 2 + 3] - az;
    const l2 = dx * dx + dz * dz || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const off = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (off < best.off) best = { d: path.cum[i] + Math.sqrt(l2) * t, off };
  }
  return best;
}

export function makePaddleRoute(c: Central): PaddleRoute | null {
  const river = c.rivers.ladybird;
  if (!river) return null;
  const [rx, rz] = project(-97.78683, 30.29103); // Red Bud Isle
  const i0 = nearestIndex(river.line, rx, rz);
  const path = new Path(river.line.slice(i0 * 2));
  const L = path.length;
  const waypoints: Waypoint[] = [];

  // Landmarks within sight of the water (not the lake and its trail, which are the journey).
  for (const p of PLACES) {
    if (p.id === "lady-bird-lake" || p.id === "butler-trail") continue;
    const { d, off } = project1(path, p.x, p.z);
    if (off < 0.7 && d > 0.05) waypoints.push({ name: p.name, s: d / L, kind: "place", placeId: p.id });
  }
  const seen = new Set<string>();
  for (const b of c.bridges) {
    const name = BRIDGE_NAMES[b.name];
    if (!name || seen.has(name)) continue;
    const l = b.line;
    const n = l.length / 2;
    const { d, off } = project1(path, (l[0] + l[n * 2 - 2]) / 2, (l[1] + l[n * 2 - 1]) / 2);
    if (off < 0.15) {
      seen.add(name);
      waypoints.push({ name, s: d / L, kind: "bridge" });
    }
  }
  waypoints.sort((a, b) => a.s - b.s);
  return { path, waypoints };
}
