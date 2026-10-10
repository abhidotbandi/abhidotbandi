// The device tier, decided before any data loads: phones, tablets and low-core machines get
// coarser rasters and meshes and fewer instanced people, trees and bats.

let cached: boolean | null = null;

export function isLowPower(): boolean {
  if (cached !== null) return cached;
  if (typeof window === "undefined") return false;
  cached = window.matchMedia("(pointer: coarse)").matches || (navigator.hardwareConcurrency ?? 8) <= 4;
  return cached;
}
