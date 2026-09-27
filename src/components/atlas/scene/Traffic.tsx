"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Polyline } from "@/lib/atlas/assets";
import { groundY, type HeightField } from "@/lib/atlas/geo";
import { runtime } from "@/lib/atlas/store";
import { sky } from "@/lib/atlas/timeOfDay";

interface Path {
  pts: Float32Array; // x,y,z
  cum: Float32Array;
  len: number;
}

function toPath(l: Polyline, height: HeightField): Path {
  const n = l.length / 2;
  const pts = new Float32Array(n * 3);
  const cum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = l[i * 2];
    const z = l[i * 2 + 1];
    pts.set([x, groundY(height, x, z) + 0.014, z], i * 3);
    if (i) cum[i] = cum[i - 1] + Math.hypot(x - pts[i * 3 - 3], z - pts[i * 3 - 1]);
  }
  return { pts, cum, len: cum[n - 1] };
}

function at(p: Path, d: number, out: Float32Array, o: number) {
  let lo = 0;
  let hi = p.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.cum[mid] < d) lo = mid;
    else hi = mid;
  }
  const f = (d - p.cum[lo]) / (p.cum[hi] - p.cum[lo] || 1);
  for (let k = 0; k < 3; k++) out[o + k] = p.pts[lo * 3 + k] + (p.pts[hi * 3 + k] - p.pts[lo * 3 + k]) * f;
}

interface Sim {
  paths: Path[];
  car: Int32Array;
  d: Float32Array;
  v: Float32Array;
}

function makeTraffic(lines: Polyline[], height: HeightField, count: number): THREE.Points {
  const paths = lines.map((l) => toPath(l, height)).filter((p) => p.len > 0.4);
  const total = paths.reduce((a, p) => a + p.len, 0);
  const car = new Int32Array(count);
  const d = new Float32Array(count);
  const v = new Float32Array(count);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Longer highways get proportionally more cars.
    let r = Math.random() * total;
    let k = 0;
    while (k < paths.length - 1 && r > paths[k].len) r -= paths[k++].len;
    car[i] = k;
    d[i] = Math.random() * paths[k].len;
    v[i] = (Math.random() < 0.5 ? -1 : 1) * (0.018 + Math.random() * 0.012); // km/s, time-lapsed
    col.set(v[i] < 0 ? [1, 0.18, 0.12] : [1, 0.93, 0.78], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 2.4,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 15;
  points.userData.sim = { paths, car, d, v } satisfies Sim;
  return points;
}

/** Headlights and taillights crawling along the highways after dark. */
export default function Traffic({ lines, height, count }: { lines: Polyline[]; height: HeightField; count: number }) {
  const ref = useRef<THREE.Points>(null);
  const points = useMemo(() => makeTraffic(lines, height, count), [lines, height, count]);

  useFrame((_, dt) => {
    const p = ref.current;
    if (!p) return;
    const m = p.material as THREE.PointsMaterial;
    const want = sky.uNight.value > 0.3 ? Math.min(1, (sky.uNight.value - 0.3) * 2) : 0;
    m.opacity += (want - m.opacity) * 0.08;
    p.visible = m.opacity > 0.02;
    if (!p.visible) return;
    const pos = p.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const step = runtime.reducedMotion ? 0 : Math.min(dt, 0.1);
    const { paths, car, d, v } = p.userData.sim as Sim;
    for (let i = 0; i < car.length; i++) {
      const path = paths[car[i]];
      d[i] += v[i] * step;
      if (d[i] < 0) d[i] += path.len;
      else if (d[i] > path.len) d[i] -= path.len;
      at(path, d[i], arr, i * 3);
    }
    pos.needsUpdate = true;
    m.size = 1.6 + (1 - sky.uZoomOut.value) * 1.6;
  });

  return <primitive ref={ref} object={points} />;
}
