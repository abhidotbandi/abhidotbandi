"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { inCentral } from "@/lib/atlas/central";
import { CX_MIN, CZ_MIN, elevToY } from "@/lib/atlas/geo";
import type { WaterLevels } from "@/lib/atlas/prep/compute";
import { runtime } from "@/lib/atlas/store";
import { sky } from "@/lib/atlas/timeOfDay";
import { makeBuildingMaterial } from "./Buildings";

// The lakes' reflections. Each frame what stands tall enough to show in them (the skyline, as
// a mesh of its own, the bridges, the sky and its clouds: the mirror layer) is drawn again, at
// half resolution, from the camera mirrored in the water's surface, clipped at the surface (an
// oblique near plane, so no material needs to know); the terrain's water samples it (see
// Terrain.tsx), ripples breaking it up. Lady Bird Lake and Lake Austin lie at different levels, and a mirror is one plane: it
// takes the level of the water that fills most of the view around what the camera looks at,
// and water at other levels keeps to the sky's reflection. Desktop only.

/** A tiling map of wind-ripple normals: waves on integer wave vectors (so it tiles), mostly
 * running before a south-easterly breeze, amplitude falling with frequency. */
function rippleNormals(size = 128): THREE.DataTexture {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const waves: [number, number, number, number][] = [];
  const wind = Math.atan2(-0.8, -0.6);
  while (waves.length < 40) {
    const k = 2 + rnd() * rnd() * 34;
    const a = wind + (rnd() - 0.5) * 2.2;
    const kx = Math.round(k * Math.cos(a));
    const ky = Math.round(k * Math.sin(a));
    if (!kx && !ky) continue;
    waves.push([kx, ky, 1 / Math.pow(Math.hypot(kx, ky), 1.35), rnd() * Math.PI * 2]);
  }
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const [kx, ky, amp, ph] of waves) v += amp * Math.sin(((kx * x + ky * y) / size) * Math.PI * 2 + ph);
      h[y * size + x] = v;
    }
  }
  let max = 0;
  const d = new Float32Array(size * size * 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)];
      const dy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x];
      d[(y * size + x) * 2] = dx;
      d[(y * size + x) * 2 + 1] = dy;
      max = Math.max(max, Math.abs(dx), Math.abs(dy));
    }
  }
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const nx = -(d[i * 2] / max) * 0.8;
    const nz = -(d[i * 2 + 1] / max) * 0.8;
    const inv = 1 / Math.hypot(nx, 1, nz);
    px[i * 4] = (nx * inv * 0.5 + 0.5) * 255;
    px[i * 4 + 1] = (inv * 0.5 + 0.5) * 255;
    px[i * 4 + 2] = (nz * inv * 0.5 + 0.5) * 255;
    px[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(px, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Objects the lakes mirror are on this layer as well as (or, the skyline, instead of) the default. */
export const MIRROR_LAYER = 3;

/** Put an object in the lakes' reflection. */
export function mirrored(o: THREE.Object3D) {
  o.layers.enable(MIRROR_LAYER);
}

const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
blank.needsUpdate = true;

/** Shared by both terrain materials. */
export const water = {
  uWaterNormals: { value: null as THREE.Texture | null },
  uReflection: { value: blank as THREE.Texture },
  uReflMatrix: { value: new THREE.Matrix4() },
  uReflOn: { value: 0 },
  uReflY: { value: 0 },
};

/** The ripple map, made on first use. */
export function waterUniforms() {
  water.uWaterNormals.value ??= rippleNormals();
  return water;
}

/** The level (m) of the water filling most of the ground within `r` km of (x, z), or NaN. */
function levelAround(w: WaterLevels, x: number, z: number, r: number): number {
  const i0 = Math.floor((x - CX_MIN) / w.cell);
  const j0 = Math.floor((z - CZ_MIN) / w.cell);
  const n = Math.ceil(r / w.cell);
  const bins = new Map<number, number>();
  for (let j = j0 - n; j <= j0 + n; j++) {
    for (let i = i0 - n; i <= i0 + n; i++) {
      if (i < 0 || j < 0 || i >= w.nx || j >= w.nz) continue;
      const v = w.level[j * w.nx + i];
      if (Number.isNaN(v)) continue;
      const k = Math.round(v);
      // Nearer water counts for more.
      bins.set(k, (bins.get(k) ?? 0) + 1 / (1 + Math.hypot(i - i0, j - j0) * 0.25));
    }
  }
  let best = Number.NaN;
  let most = 0;
  for (const [k, c] of bins) {
    if (c > most) {
      most = c;
      best = k;
    }
  }
  return best;
}

const normal = new THREE.Vector3(0, 1, 0);
const mirrorPos = new THREE.Vector3();
const camPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const rot = new THREE.Matrix4();
const target = new THREE.Vector3();
const plane = new THREE.Plane();
const clip = new THREE.Vector4();
const q = new THREE.Vector4();
const savedCam = new THREE.Vector3();

/** The skyline mesh: in the reflection only. */
const skylineOnly = (m: THREE.Object3D) => m.layers.set(MIRROR_LAYER);

export default function WaterReflection({ levels, skyline }: { levels: WaterLevels; skyline: THREE.BufferGeometry | null }) {
  const holder = useMemo(() => {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true, generateMipmaps: false });
    rt.texture.minFilter = THREE.LinearFilter;
    const mirror = new THREE.PerspectiveCamera();
    mirror.layers.set(MIRROR_LAYER);
    const o = new THREE.Object3D();
    o.userData = { rt, mirror, level: { x: Number.NaN, z: Number.NaN, r: 0, value: Number.NaN } };
    return o;
  }, []);
  const material = useMemo(() => makeBuildingMaterial(), []);
  const ref = useRef<THREE.Object3D>(null);
  useEffect(
    () => () => {
      (holder.userData.rt as THREE.WebGLRenderTarget).dispose();
      water.uReflOn.value = 0;
      water.uReflection.value = blank;
    },
    [holder],
  );

  useFrame((state) => {
    const o = ref.current;
    if (!o) return;
    const { rt, mirror, level: lv } = o.userData as {
      rt: THREE.WebGLRenderTarget;
      mirror: THREE.PerspectiveCamera;
      level: { x: number; z: number; r: number; value: number };
    };
    const gl = state.gl;
    const cam = runtime.cam;
    const camera = state.camera as THREE.PerspectiveCamera;
    water.uReflOn.value = 0;
    // Off if the frame rate governor has dropped it (AtlasCanvas).
    if (runtime.quality >= 3 || cam.dist > 9 || !inCentral(cam.x, cam.z)) return;
    // Which water fills the view: looked up again only when the view has moved a little.
    const r = Math.min(4, Math.max(1, cam.dist * 0.8));
    if (!(Math.hypot(cam.x - lv.x, cam.z - lv.z) < 0.05 && Math.abs(r - lv.r) < lv.r * 0.1)) {
      Object.assign(lv, { x: cam.x, z: cam.z, r, value: levelAround(levels, cam.x, cam.z, r) });
    }
    const level = lv.value;
    if (Number.isNaN(level)) return;
    const y = elevToY(level);
    camera.updateMatrixWorld();
    camPos.setFromMatrixPosition(camera.matrixWorld);
    // Just above the surface, so the water itself is clipped away and only what stands above it
    // is mirrored.
    const planeY = y + 0.0006;
    if (camPos.y <= planeY) return;

    // The mirrored camera (as three's Reflector does it).
    mirrorPos.set(camPos.x, 2 * planeY - camPos.y, camPos.z);
    rot.extractRotation(camera.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    target.set(lookAt.x, 2 * planeY - lookAt.y, lookAt.z);
    mirror.position.copy(mirrorPos);
    mirror.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    mirror.lookAt(target);
    mirror.far = camera.far;
    mirror.near = camera.near;
    mirror.updateMatrixWorld();
    mirror.projectionMatrix.copy(camera.projectionMatrix);
    mirror.projectionMatrixInverse.copy(camera.projectionMatrixInverse);

    // Clip at the surface with an oblique near plane.
    plane.setFromNormalAndCoplanarPoint(normal, target.set(0, planeY, 0));
    plane.applyMatrix4(mirror.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const e = mirror.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + e[8]) / e[0];
    q.y = (Math.sign(clip.y) + e[9]) / e[5];
    q.z = -1.0;
    q.w = (1.0 + e[10]) / e[14];
    clip.multiplyScalar(2.0 / clip.dot(q));
    e[2] = clip.x;
    e[6] = clip.y;
    e[10] = clip.z + 1.0;
    e[14] = clip.w;

    const w = Math.max(1, Math.floor(state.gl.domElement.width / 2));
    const h = Math.max(1, Math.floor(state.gl.domElement.height / 2));
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h);

    // Draw the mirrored scene; the water doesn't sample its own reflection meanwhile, and the
    // materials that shade by the view see it from the mirrored camera.
    savedCam.copy(sky.uCamPos.value);
    sky.uCamPos.value.copy(mirrorPos);
    water.uReflection.value = blank;
    // (The shadow map is left for the main pass: drawn from here it would hold the mirror layer only.)
    const shadows = gl.shadowMap.needsUpdate;
    gl.shadowMap.needsUpdate = false;
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(rt);
    gl.clear();
    gl.render(state.scene, mirror);
    gl.setRenderTarget(prev);
    gl.shadowMap.needsUpdate = shadows;
    sky.uCamPos.value.copy(savedCam);

    water.uReflection.value = rt.texture;
    water.uReflY.value = y;
    water.uReflMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    water.uReflMatrix.value.multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);
    water.uReflOn.value = 1;
  });
  return (
    <>
      <primitive ref={ref} object={holder} />
      {skyline && <mesh geometry={skyline} material={material} frustumCulled={false} onUpdate={skylineOnly} />}
    </>
  );
}
