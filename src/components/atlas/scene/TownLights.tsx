"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { AtlasAssets } from "@/lib/atlas/assets";
import { elevToY, X_MAX, X_MIN, Z_MAX, Z_MIN } from "@/lib/atlas/geo";
import { sky } from "@/lib/atlas/timeOfDay";

// The towns around the map after dark (San Antonio, Killeen, Temple, San Marcos, New Braunfels
// and the rest): clusters of warm lights sized by population, so the country beyond the map
// isn't a void at night.

const vertex = /* glsl */ `
  attribute vec3 aColor;
  uniform float uSize;
  uniform float uFogDensity;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize;
    // Far towns sink into the haze with the land around them.
    float d = -mv.z;
    vColor = aColor * exp(-uFogDensity * uFogDensity * d * d);
  }
`;

const fragment = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    float a = 1.0 - smoothstep(0.35, 0.5, length(gl_PointCoord - 0.5));
    gl_FragColor = vec4(vColor * a * uOpacity, 1.0);
    #include <colorspace_fragment>
  }
`;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeLights(a: AtlasAssets, lowPower: boolean): THREE.Points | null {
  const o = a.outer;
  const m = a.meta.outer;
  if (!o || !m) return null;
  const [x0, z0, w, h] = m.bounds;
  /** Ground height (m) from the outer raster, bilinear. */
  const sample = (x: number, z: number) => {
    const u = Math.min(o.width - 1.001, Math.max(0, ((x - x0) / w) * o.width - 0.5));
    const v = Math.min(o.height - 1.001, Math.max(0, ((z - z0) / h) * o.height - 0.5));
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fx = u - i;
    const fz = v - j;
    const e = o.elev;
    const k = j * o.width + i;
    const top = e[k] + (e[k + 1] - e[k]) * fx;
    const bot = e[k + o.width] + (e[k + o.width + 1] - e[k + o.width]) * fx;
    return top + (bot - top) * fz;
  };
  // The terrain out here is a coarse grid (cells up to ~2 km), so in a valley its surface can
  // pass above the raster's: take the highest ground nearby, so no light is buried.
  const ground = (x: number, z: number) => {
    let top = -Infinity;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) top = Math.max(top, sample(x + dx * 1.1, z + dz * 1.1));
    return top;
  };
  const rand = rng(42);
  const pos: number[] = [];
  const col: number[] = [];
  const warm = new THREE.Color("#ffb766");
  const pale = new THREE.Color("#ffe6c2");
  const c = new THREE.Color();
  for (const [tx, tz, pop] of m.towns) {
    const n = Math.min(lowPower ? 160 : 420, Math.max(6, Math.round(Math.sqrt(pop) * (lowPower ? 0.18 : 0.45))));
    const r = 0.35 + 0.012 * Math.sqrt(pop);
    for (let i = 0; i < n; i++) {
      // Denser towards the centre, like a town thinning into its outskirts.
      const d = r * Math.pow(rand(), 0.8);
      const t = rand() * Math.PI * 2;
      const x = tx + Math.cos(t) * d;
      const z = tz + Math.sin(t) * d;
      const b = rand();
      const k = rand();
      if (x > X_MIN && x < X_MAX && z > Z_MIN && z < Z_MAX) continue; // the map has its own lights
      pos.push(x, elevToY(ground(x, z)) + 0.03, z);
      c.copy(warm).lerp(pale, k * 0.4).multiplyScalar(0.3 + b * 0.4);
      col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aColor", new THREE.Float32BufferAttribute(col, 3));
  const p = new THREE.Points(
    g,
    new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uSize: { value: 2 }, uOpacity: { value: 0 }, uFogDensity: sky.uFogDensity },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  p.frustumCulled = false;
  p.renderOrder = 14;
  return p;
}

export default function TownLights({ assets, lowPower }: { assets: AtlasAssets; lowPower: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const points = useMemo(() => makeLights(assets, lowPower), [assets, lowPower]);
  useFrame(({ gl }) => {
    const p = ref.current;
    if (!p) return;
    const u = (p.material as THREE.ShaderMaterial).uniforms;
    u.uOpacity.value = THREE.MathUtils.smoothstep(sky.uNight.value, 0.35, 0.9);
    p.visible = u.uOpacity.value > 0.01;
    u.uSize.value = (1.8 + (1 - sky.uZoomOut.value) * 1.2) * gl.getPixelRatio();
  });
  return points ? <primitive ref={ref} object={points} /> : null;
}
