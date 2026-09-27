import { SITE_BY_ID } from "@/data/atlas/companies";
import { STOPS, type Stop } from "@/data/atlas/tour";
import { flight, type CamState, type Flight } from "./camera";
import { clamp, project } from "./geo";

/** A stop's camera: its own view, or one fitted around the sites it features. */
export function stopCam(stop: Stop): CamState {
  const v = stop.view;
  const pts = (stop.frame ?? stop.sites).map((id) => SITE_BY_ID.get(id)).filter((s) => s !== undefined);
  if (v.fixed || pts.length < 2) {
    const [x, z] = project(v.lon, v.lat);
    return { x, z, dist: v.dist, tilt: v.tilt, bearing: v.bearing };
  }
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const s of pts) {
    x0 = Math.min(x0, s.x);
    x1 = Math.max(x1, s.x);
    z0 = Math.min(z0, s.z);
    z1 = Math.max(z1, s.z);
  }
  // Depth is foreshortened by the tilt, so the across-screen and into-screen spans
  // are weighed by how the bearing maps them onto the view.
  const b = (v.bearing * Math.PI) / 180;
  const w = Math.abs((x1 - x0) * Math.cos(b)) + Math.abs((z1 - z0) * Math.sin(b));
  const d = Math.abs((x1 - x0) * Math.sin(b)) + Math.abs((z1 - z0) * Math.cos(b));
  // Cards cover part of the screen, so leave extra room across it.
  const extent = Math.max(w * 1.45, d * 1.6);
  return {
    x: (x0 + x1) / 2,
    z: (z0 + z1) / 2,
    dist: clamp(1.4 + extent * 1.55, 2.4, 40),
    tilt: v.tilt,
    bearing: v.bearing,
  };
}

interface Leg {
  from: number;
  to: number;
  start: number;
  end: number;
  flight: Flight;
}

/**
 * The scroll timeline, measured in "screens" (viewport heights). Each stop gets a
 * dwell (camera holds and drifts while its card is read), then a transit to the next
 * stop whose length grows with how far the flight travels.
 */
export class Timeline {
  readonly stops = STOPS;
  readonly cams = STOPS.map(stopCam);
  /** [start, end] of each stop's dwell, in screens */
  readonly dwell: [number, number][] = [];
  readonly legs: Leg[] = [];
  readonly total: number;

  constructor() {
    // Start half-way through the first dwell so the intro card is centred at scroll 0.
    let t = -(STOPS[0].dwell ?? 1.1) / 2;
    STOPS.forEach((stop, i) => {
      const d = stop.dwell ?? 1.1;
      this.dwell.push([t, t + d]);
      t += d;
      if (i < STOPS.length - 1) {
        const f = flight(this.cams[i], this.cams[i + 1]);
        const len = clamp(0.7 + f.S * 0.32, 0.9, 2.4);
        this.legs.push({ from: i, to: i + 1, start: t, end: t + len, flight: f });
        t += len;
      }
    });
    this.total = t - (STOPS[STOPS.length - 1].dwell ?? 1.1) / 2;
  }

  /** Scroll position (screens) where a stop's card is centred. */
  stopCenter(i: number): number {
    const [a, b] = this.dwell[i];
    return (a + b) / 2;
  }

  /** Camera, time of day and the nearest stop for a scroll position in screens. */
  sample(pos: number, out: CamState): { tod: number; stop: number; blend: number } {
    const p = clamp(pos, 0, this.total);
    for (let i = 0; i < this.dwell.length; i++) {
      const [a, b] = this.dwell[i];
      if (p <= b || i === this.dwell.length - 1) {
        if (p >= a || i === 0) {
          const k = clamp((p - a) / (b - a), 0, 1);
          const c = this.cams[i];
          out.x = c.x;
          out.z = c.z;
          out.dist = c.dist * (1 - 0.06 * k);
          out.tilt = c.tilt;
          out.bearing = c.bearing + (k - 0.5) * 7;
          return { tod: STOPS[i].tod, stop: i, blend: 0 };
        }
        break;
      }
    }
    const leg = this.legs.find((l) => p >= l.start && p <= l.end) ?? this.legs[this.legs.length - 1];
    const t = clamp((p - leg.start) / (leg.end - leg.start), 0, 1);
    const c = leg.flight.at(t);
    // Match the dwell drift at both ends so there is no jump in bearing or distance.
    out.x = c.x;
    out.z = c.z;
    out.dist = c.dist * (1 - 0.06 * (1 - t));
    out.tilt = c.tilt;
    out.bearing = c.bearing + 3.5 - 7 * t;
    const tod = STOPS[leg.from].tod + (STOPS[leg.to].tod - STOPS[leg.from].tod) * t;
    return { tod, stop: t < 0.5 ? leg.from : leg.to, blend: t };
  }
}

let shared: Timeline | null = null;
export function getTimeline(): Timeline {
  shared ??= new Timeline();
  return shared;
}
