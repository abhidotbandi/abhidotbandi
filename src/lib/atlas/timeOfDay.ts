import * as THREE from "three";
import { clamp } from "./geo";

interface Key {
  t: number;
  zenith: string;
  horizon: string;
  /** the "paper" the map sheet sits on, seen past the region's edge */
  ground: string;
  sun: string;
  sunElev: number; // degrees
  ambient: string;
  night: number;
}

// Dawn over the Hill Country to night over the city. Warm, slightly hazy Texas light.
const KEYS: Key[] = [
  { t: 0.0, zenith: "#27365c", horizon: "#e2a584", ground: "#b9ab98", sun: "#ff9d6a", sunElev: -1, ambient: "#8e8aa4", night: 0.55 },
  { t: 0.08, zenith: "#7d97bf", horizon: "#f3cfac", ground: "#e6dccb", sun: "#ffc08c", sunElev: 7, ambient: "#b8b3bf", night: 0.12 },
  { t: 0.24, zenith: "#86b1d9", horizon: "#eef0ea", ground: "#ebe4d4", sun: "#fff1dc", sunElev: 34, ambient: "#c9d0d6", night: 0 },
  { t: 0.5, zenith: "#79acdc", horizon: "#f1f2ec", ground: "#ece5d5", sun: "#ffffff", sunElev: 64, ambient: "#cfd6db", night: 0 },
  { t: 0.7, zenith: "#7aa5d3", horizon: "#f3ecdd", ground: "#ebe2d0", sun: "#fff3dc", sunElev: 34, ambient: "#cdd0d2", night: 0 },
  { t: 0.79, zenith: "#8196c3", horizon: "#f7d6a4", ground: "#e6d8bf", sun: "#ffc27e", sunElev: 13, ambient: "#c9c2bd", night: 0 },
  { t: 0.86, zenith: "#4c5a90", horizon: "#f3a176", ground: "#a79382", sun: "#ff8d55", sunElev: 2.5, ambient: "#a29aa8", night: 0.28 },
  { t: 0.92, zenith: "#1f2752", horizon: "#7b5b87", ground: "#2c2a3e", sun: "#ff6d45", sunElev: -5, ambient: "#5e6384", night: 0.75 },
  { t: 1.0, zenith: "#070b1a", horizon: "#19203c", ground: "#0b0f1e", sun: "#ff6d45", sunElev: -18, ambient: "#39406a", night: 1 },
];

const KEY_COLORS = KEYS.map((k) => ({
  zenith: new THREE.Color(k.zenith),
  horizon: new THREE.Color(k.horizon),
  ground: new THREE.Color(k.ground),
  sun: new THREE.Color(k.sun),
  ambient: new THREE.Color(k.ambient),
}));

/** Uniforms shared by every atlas material, updated once per frame. */
export const sky = {
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uGround: { value: new THREE.Color() },
  /** the scene's FogExp2 density, so the sky's ground fogs as the terrain does */
  uFogDensity: { value: 0.01 },
  /**
   * The fog's colour as the map's own shaders blend it. three hands fog colours to shaders
   * already encoded for the screen (its own materials fog after encoding); ours fog before,
   * so what they show is the horizon's colour encoded twice, a lighter haze than the sky's.
   * The sky meets that haze with this.
   */
  uFogColor: { value: new THREE.Color() },
  uSunColor: { value: new THREE.Color() },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uAmbient: { value: new THREE.Color() },
  uNight: { value: 0 },
  uTime: { value: 0 },
  uCamPos: { value: new THREE.Vector3() },
  /** 0..1 how zoomed-out the camera is (region view = 1) */
  uZoomOut: { value: 0 },
};

export function applyTimeOfDay(tod: number) {
  const t = clamp(tod, 0, 1);
  let i = 0;
  while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const k = clamp((t - a.t) / (b.t - a.t), 0, 1);
  const ca = KEY_COLORS[i];
  const cb = KEY_COLORS[i + 1];
  sky.uZenith.value.copy(ca.zenith).lerp(cb.zenith, k);
  sky.uHorizon.value.copy(ca.horizon).lerp(cb.horizon, k);
  sky.uGround.value.copy(ca.ground).lerp(cb.ground, k);
  sky.uSunColor.value.copy(ca.sun).lerp(cb.sun, k);
  sky.uAmbient.value.copy(ca.ambient).lerp(cb.ambient, k);
  sky.uNight.value = a.night + (b.night - a.night) * k;
  // Sun rises in the east, arcs through the south, sets in the west. Once it is below
  // the horizon there is no direct light, only sky.
  const elevDeg = a.sunElev + (b.sunElev - a.sunElev) * k;
  const up = clamp((elevDeg + 3) / 7, 0, 1);
  sky.uSunColor.value.multiplyScalar(up * up * (3 - 2 * up));
  const elev = (elevDeg * Math.PI) / 180;
  const az = ((90 + clamp(t / 0.9, 0, 1) * 180) * Math.PI) / 180;
  const ce = Math.cos(Math.max(elev, 0.04));
  sky.uSunDir.value.set(Math.sin(az) * ce, Math.sin(Math.max(elev, 0.04)), -Math.cos(az) * ce).normalize();
}

applyTimeOfDay(0.1);
