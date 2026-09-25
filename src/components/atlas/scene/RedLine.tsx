"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { Vectors } from "@/lib/atlas/assets";
import { groundY, type RegionRaster } from "@/lib/atlas/geo";
import { runtime, useAtlas } from "@/lib/atlas/store";
import { sky } from "@/lib/atlas/timeOfDay";

/** Seconds for the ride from Leander to Downtown. */
export const RIDE_SECONDS = 80;

export interface Track {
  pts: Float32Array; // x,y,z
  cum: Float32Array; // cumulative length, km
  length: number;
}

export function buildTrack(line: Float32Array, height: RegionRaster): Track {
  // Resample every ~40 m so the train follows the terrain smoothly.
  const out: number[] = [];
  for (let i = 0; i + 3 < line.length; i += 2) {
    const ax = line[i];
    const az = line[i + 1];
    const bx = line[i + 2];
    const bz = line[i + 3];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.04));
    for (let s = 0; s < n; s++) {
      const x = ax + ((bx - ax) * s) / n;
      const z = az + ((bz - az) * s) / n;
      out.push(x, groundY(height, x, z) + 0.012, z);
    }
  }
  const lx = line[line.length - 2];
  const lz = line[line.length - 1];
  out.push(lx, groundY(height, lx, lz) + 0.012, lz);
  const pts = new Float32Array(out);
  const cum = new Float32Array(pts.length / 3);
  for (let i = 1; i < cum.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 2] - pts[i * 3 - 1]);
  }
  return { pts, cum, length: cum[cum.length - 1] };
}

/** Position and heading (radians, clockwise from north) at fraction s of the track. */
export function trackAt(tr: Track, s: number, out: THREE.Vector3): number {
  const d = Math.max(0, Math.min(1, s)) * tr.length;
  let lo = 0;
  let hi = tr.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tr.cum[mid] < d) lo = mid;
    else hi = mid;
  }
  const seg = tr.cum[hi] - tr.cum[lo] || 1;
  const f = (d - tr.cum[lo]) / seg;
  const p = tr.pts;
  out.set(
    p[lo * 3] + (p[hi * 3] - p[lo * 3]) * f,
    p[lo * 3 + 1] + (p[hi * 3 + 1] - p[lo * 3 + 1]) * f,
    p[lo * 3 + 2] + (p[hi * 3 + 2] - p[lo * 3 + 2]) * f,
  );
  return Math.atan2(p[hi * 3] - p[lo * 3], -(p[hi * 3 + 2] - p[lo * 3 + 2]));
}

const pos = new THREE.Vector3();
const ahead = new THREE.Vector3();

export default function RedLine({ vectors, height }: { vectors: Vectors; height: RegionRaster }) {
  const train = useRef<THREE.Group>(null);
  const stations = useRef<THREE.InstancedMesh>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const lastUi = useRef(0);

  const { track, line, material, stationPos } = useMemo(() => {
    const track = buildTrack(vectors.redLine.line, height);
    const geo = new LineGeometry();
    geo.setPositions(track.pts);
    const material = new LineMaterial({ color: "#c8102e", linewidth: 3, fog: true, transparent: true, depthWrite: false });
    const line = new Line2(geo, material);
    line.renderOrder = 12;
    line.frustumCulled = false;
    const stationPos = vectors.redLine.stations.map((st) => {
      const v = new THREE.Vector3();
      trackAt(track, st.at, v);
      return v;
    });
    return { track, line, material, stationPos };
  }, [vectors, height]);

  const bodyMat = useMemo(() => new THREE.MeshLambertMaterial({ color: "#f5f3ef" }), []);
  const stripeMat = useMemo(() => new THREE.MeshLambertMaterial({ color: "#c8102e", emissive: "#3a0008" }), []);
  const carGeo = useMemo(() => new THREE.BoxGeometry(0.02, 0.018, 0.06), []);
  const stripeGeo = useMemo(() => new THREE.BoxGeometry(0.0205, 0.005, 0.0605), []);
  const stationGeo = useMemo(() => new THREE.SphereGeometry(1, 12, 8), []);
  const stationMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ffffff", fog: true, toneMapped: false }), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state, dt) => {
    const st = useAtlas.getState();
    const t = state.clock.elapsedTime;
    let s: number;
    let dir = 1;
    if (st.mode === "ride") {
      if (!st.ridePaused && !runtime.reducedMotion) {
        runtime.rideS = Math.min(1, runtime.rideS + Math.min(dt, 0.1) / RIDE_SECONDS);
      }
      s = runtime.rideS;
      // Mirror into React state a few times a second for the ride HUD.
      if (t - lastUi.current > 0.2 || (s >= 1 && st.rideProgress < 1)) {
        lastUi.current = t;
        st.setRideProgress(s);
      }
    } else {
      const cyc = (t / 140) % 2;
      s = cyc < 1 ? cyc : 2 - cyc;
      dir = cyc < 1 ? 1 : -1;
    }
    const heading = trackAt(track, s, pos) + (dir < 0 ? Math.PI : 0);
    runtime.trainPos.x = pos.x;
    runtime.trainPos.z = pos.z;
    runtime.trainPos.heading = heading;

    const g = train.current;
    if (g) {
      g.position.copy(pos);
      trackAt(track, Math.min(1, s + 0.0008 * dir), ahead);
      g.lookAt(ahead.x, pos.y, ahead.z);
      const zoomIn = st.mode === "ride" ? 1 : THREE.MathUtils.clamp(3 - runtime.cam.dist / 4, 0.8, 3);
      g.scale.setScalar(zoomIn);
    }

    const night = sky.uNight.value;
    material.color.set(night > 0.5 ? "#ff4d5e" : "#c8102e");
    material.linewidth = st.mode === "ride" ? 4 : 2.2 + (1 - sky.uZoomOut.value) * 1.2;
    material.opacity = 0.55 + 0.45 * (1 - sky.uZoomOut.value * 0.6);

    const sm = stations.current;
    if (sm) {
      const k = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, size.height);
      stationPos.forEach((p, i) => {
        const px = camera.position.distanceTo(p) * k;
        dummy.position.copy(p);
        dummy.scale.setScalar(px * (runtime.cam.dist < 30 ? 3.2 : 0));
        dummy.updateMatrix();
        sm.setMatrixAt(i, dummy.matrix);
      });
      sm.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      <primitive object={line} />
      <instancedMesh ref={stations} args={[stationGeo, stationMat, stationPos.length]} frustumCulled={false} renderOrder={13} />
      <group ref={train}>
        <mesh geometry={carGeo} material={bodyMat} position={[0, 0.009, 0.031]} />
        <mesh geometry={stripeGeo} material={stripeMat} position={[0, 0.012, 0.031]} />
        <mesh geometry={carGeo} material={bodyMat} position={[0, 0.009, -0.031]} />
        <mesh geometry={stripeGeo} material={stripeMat} position={[0, 0.012, -0.031]} />
      </group>
    </group>
  );
}
