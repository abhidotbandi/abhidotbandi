import {
  CAPITOL_ANCHOR,
  CAPITOL_AXIS_DEG,
  FOUNTAINS,
  GREAT_WALK,
  MONUMENTS,
  OPEN_ROTUNDA,
  SKYLIGHTS,
  SOUTH_STEPS,
} from "@/data/atlas/capitol";
import { project } from "./geo";

// The Capitol's frame (see data/atlas/capitol.ts): (u, v) metres east and north along its axes,
// to and from scene km, and the places on its grounds that trees and plain extrusions keep off.

const [AX, AZ] = project(...CAPITOL_ANCHOR);
/** The frame's turn about +y, for models authored with +x along u and -z along v. */
export const CAPITOL_YAW = (CAPITOL_AXIS_DEG * Math.PI) / 180;
const CT = Math.cos(CAPITOL_YAW);
const ST = Math.sin(CAPITOL_YAW);

/** Scene point (km) at (u, v) in the Capitol's frame. */
export function capitolAt(u: number, v: number): [number, number] {
  return [AX + (u * CT - v * ST) / 1000, AZ - (u * ST + v * CT) / 1000];
}

/** (u, v) in the Capitol's frame of a scene point (km). */
export function capitolUV(x: number, z: number): [number, number] {
  const e = (x - AX) * 1000;
  const n = (AZ - z) * 1000;
  return [e * CT + n * ST, -e * ST + n * CT];
}

/** The Capitol Extension's skylights stand in the building files as little blocks. */
export function isCapitolSkylight(x: number, z: number): boolean {
  if (Math.abs(x - AX) > 0.3 || Math.abs(z - AZ) > 0.3) return false;
  const [u, v] = capitolUV(x, z);
  return SKYLIGHTS.some(([su, sv, a, b]) => Math.abs(u - su) < a / 2 + 3 && Math.abs(v - sv) < b / 2 + 3);
}

/** A rectangle in the frame as a ring (flat x, z km). */
function rect(u0: number, u1: number, v0: number, v1: number): number[] {
  return [capitolAt(u0, v0), capitolAt(u1, v0), capitolAt(u1, v1), capitolAt(u0, v1)].flat();
}

/** A circle as a ring (flat x, z km). */
function circle(x: number, z: number, rM: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    out.push(x + (Math.cos(a) * rM) / 1000, z + (Math.sin(a) * rM) / 1000);
  }
  return out;
}

/** Where the grounds' trees keep clear: the Great Walk, the fountains, monuments and skylights. */
export function capitolClearings(): number[][] {
  const w = GREAT_WALK;
  const out = [
    rect(w.u - w.width / 2 - 4, w.u + w.width / 2 + 4, w.from, w.to),
    rect(w.u - SOUTH_STEPS.width / 2 - 3, w.u + SOUTH_STEPS.width / 2 + 3, SOUTH_STEPS.from - 3, SOUTH_STEPS.to),
    circle(...capitolAt(OPEN_ROTUNDA.u, OPEN_ROTUNDA.v), OPEN_ROTUNDA.r + 4),
    ...FOUNTAINS.map(([u, v]) => circle(...capitolAt(u, v), 8)),
    ...MONUMENTS.map((m) => circle(...project(...m.at), m.kind === "ring" ? 12 : 8)),
    ...SKYLIGHTS.map(([u, v, a, b]) => rect(u - a / 2 - 3, u + a / 2 + 3, v - b / 2 - 3, v + b / 2 + 3)),
  ];
  return out;
}
