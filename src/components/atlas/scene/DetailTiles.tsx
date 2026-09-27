"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { buildingGeometry } from "@/lib/atlas/buildings";
import { tileKey, type TileMeshes } from "@/lib/atlas/detail/build";
import type { InitMessage, TileMessage } from "@/lib/atlas/detail/worker";
import { HEIGHT_KM, WIDTH_KM, X_MIN, Z_MIN, clamp, type HeightField } from "@/lib/atlas/geo";
import { runtime } from "@/lib/atlas/store";
import type { TileIndex } from "@/lib/atlas/tiles";
import { sky } from "@/lib/atlas/timeOfDay";
import { makeBuildingMaterial } from "./Buildings";
import type { PreparedScene } from "./prepare";
import { CONE, ROUND, TREE_EXAG, crownGeometry } from "./Trees";
import { CarSim, makeDeckFinder, type DeckFinder } from "./Cars";

// Street-scale detail beyond central Austin, streamed in 2 km tiles around the camera once it
// comes in close: every building, the local streets at their real width (streetlights after
// dark), parking lots, backyard pools, runways, and trees over the canopy. Tiles are decoded
// and meshed in a worker; their buildings rise out of the ground as they arrive.

const DEG = Math.PI / 180;

const LIT = /* glsl */ `
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uAmbient;
  uniform float uNight;
  uniform sampler2D uNormal;
  uniform vec4 uRegion;
  uniform float uFade;
  uniform float uAppear;
  vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
  // Lit like the ground beneath, so paint and paving sit in the terrain's light.
  vec3 groundLit(vec3 col, vec3 world) {
    vec3 n = normalize(texture2D(uNormal, (world.xz - uRegion.xy) / uRegion.zw).xyz * 2.0 - 1.0);
    float diff = max(dot(n, uSunDir), 0.0);
    return col * (uAmbient * (0.6 + 0.4 * n.y) * 0.72 + uSunColor * diff * 0.5) * (1.0 - uNight * 0.82);
  }
`;

const ribbonVertex = /* glsl */ `
  attribute vec4 aShape;
  attribute vec3 aLine;
  uniform float uPxK;
  uniform float uLift;
  varying vec3 vWorld;
  varying float vSide;
  varying vec3 vLine;
  varying float vHalfM;
  #include <fog_pars_vertex>
  void main() {
    vec4 c = viewMatrix * vec4(position, 1.0);
    // Never much thinner than a pixel, so streets don't break up from afar.
    float hw = max(aShape.w, 0.6 * uPxK * max(-c.z, 1e-3));
    vec3 p = position + vec3(aShape.x, 0.0, aShape.y) * (aShape.z * hw);
    p.y += uLift;
    vWorld = p;
    vSide = aShape.z;
    vLine = aLine;
    vHalfM = aShape.w * 1000.0;
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const ribbonFragment = /* glsl */ `
  ${LIT}
  varying vec3 vWorld;
  varying float vSide;
  varying vec3 vLine;
  varying float vHalfM;
  #include <fog_pars_fragment>
  void main() {
    float cls = vLine.x;
    float e = abs(vSide);
    float wM = vHalfM;
    float across = e * wM; // metres from the centreline
    float m = vLine.y * 1000.0; // metres along
    float close = 1.0 - smoothstep(0.35, 1.4, fwidth(across));
    bool unpaved = abs(cls - 7.0) < 0.5 || abs(cls - 9.0) < 0.5;
    vec3 col;
    if (cls > 29.5) col = cls < 30.5 ? lin(vec3(0.64, 0.64, 0.64)) : lin(vec3(0.7, 0.7, 0.69));
    else if (unpaved) col = lin(vec3(0.87, 0.8, 0.67));
    else col = lin(vec3(0.975, 0.966, 0.945));
    // A kerb: the edge a shade darker, up close.
    if (cls < 29.5 && !unpaved) col *= 1.0 - 0.12 * smoothstep(wM - 1.3, wM - 0.3, across) * close;
    float marks = 0.0;
    vec3 markCol = lin(vec3(0.98, 0.98, 0.96));
    if (cls > 29.5 && cls < 30.5) {
      // Runway: a dashed centreline and edge stripes.
      float dash = step(fract(m / 60.0), 0.55) * (1.0 - smoothstep(0.5, 1.0, across));
      float edgeS = smoothstep(wM - 2.4, wM - 1.8, across) * (1.0 - smoothstep(wM - 1.2, wM - 0.6, across));
      marks = max(dash, edgeS) * close;
    } else if (cls > 30.5) {
      marks = (1.0 - smoothstep(0.35, 0.75, across)) * close; // taxiway centreline
      markCol = lin(vec3(0.95, 0.76, 0.22));
    } else if (cls > 19.5) {
      marks = (1.0 - smoothstep(0.08, 0.28, abs(across - 0.3))) * close * 0.85; // double yellow
      markCol = lin(vec3(0.93, 0.76, 0.3));
    }
    col = mix(col, markCol, marks);
    vec3 lit = groundLit(col, vWorld);
    float dark = smoothstep(0.35, 1.0, uNight);
    // Lights along the line: spots never smaller than about a pixel, dimming as they crowd.
    float mpp = max(fwidth(m), 1e-3); // metres per pixel
    float rad = max(1.3, 1.1 * mpp);
    if (cls > 29.5) {
      // Runway edge lights (white, every 60 m) and taxiway centreline lights (green, every 30 m).
      float sp = cls < 30.5 ? 60.0 : 30.0;
      float t = m / sp;
      float lat = cls < 30.5 ? (e - 0.9) * wM : across;
      float d = length(vec2((fract(t) - 0.5) * sp, lat));
      vec3 lc = cls < 30.5 ? lin(vec3(1.0, 0.92, 0.78)) : lin(vec3(0.3, 1.0, 0.5));
      float bright = cls < 30.5 ? 2.2 : 1.1;
      lit += lc * exp(-d * d / (rad * rad)) * bright * mix(0.25, 1.0, smoothstep(2.0, 7.0, sp / mpp)) * dark;
    }
    // Streetlights after dark: warm pools along alternate kerbs; a faint glow from afar.
    float lamps = vLine.z;
    if (lamps > 0.0) {
      float t = m / lamps;
      float side = mod(floor(t), 2.0) < 0.5 ? 1.0 : -1.0;
      float d = length(vec2((fract(t) - 0.5) * lamps, (vSide - side * 0.8) * wM));
      float pool = max(3.2, rad);
      float crowd = smoothstep(2.0, 7.0, lamps / mpp);
      lit += lin(vec3(1.0, 0.72, 0.4)) * mix(0.14, exp(-d * d / (pool * pool)), crowd) * dark;
    }
    float aa = max(fwidth(vSide), 1e-4) * 1.5;
    gl_FragColor = vec4(lit, uFade * uAppear * (1.0 - smoothstep(1.0 - aa, 1.0, e)));
    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

const areaVertex = /* glsl */ `
  attribute float aKind;
  uniform float uLift;
  varying vec3 vWorld;
  varying float vKind;
  #include <fog_pars_vertex>
  void main() {
    vec3 p = position;
    p.y += uLift * 0.7;
    vWorld = p;
    vKind = aKind;
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const areaFragment = /* glsl */ `
  ${LIT}
  uniform float uTime;
  varying vec3 vWorld;
  varying float vKind;
  #include <fog_pars_fragment>
  void main() {
    float k = vKind;
    vec3 col;
    if (k < 1.5) col = lin(vec3(0.86, 0.85, 0.82)); // parking
    else if (k < 2.5) col = lin(vec3(0.74, 0.74, 0.73)); // apron
    else if (k < 3.5) col = lin(vec3(0.7, 0.7, 0.7)); // helipad
    else if (k < 10.5) col = lin(vec3(0.42, 0.8, 0.87)); // swimming pool
    else col = lin(vec3(0.58, 0.76, 0.76)); // pond
    vec3 lit = groundLit(col, vWorld);
    // Floodlit aprons and lit car parks after dark.
    float dark = smoothstep(0.35, 1.0, uNight);
    if (k < 2.5) lit += lin(vec3(1.0, 0.86, 0.62)) * (k < 1.5 ? 0.05 : 0.11) * dark;
    if (k > 9.5 && k < 10.5) {
      // Pools glint by day and glow by their own lights at night.
      vec2 w = vWorld.xz * 1000.0;
      float ripple = sin(w.x * 1.7 + uTime * 1.3) * sin(w.y * 1.9 - uTime * 1.1);
      lit += lin(vec3(0.9, 0.97, 1.0)) * smoothstep(0.75, 1.0, ripple) * 0.18 * (1.0 - uNight);
      lit += lin(vec3(0.25, 0.8, 0.95)) * 0.45 * smoothstep(0.4, 1.0, uNight);
    }
    gl_FragColor = vec4(lit, uFade * uAppear);
    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

/** Uniforms every tile shares. */
function sharedUniforms(normal: THREE.Texture) {
  return {
    uSunColor: sky.uSunColor,
    uSunDir: sky.uSunDir,
    uAmbient: sky.uAmbient,
    uNight: sky.uNight,
    uTime: sky.uTime,
    uNormal: { value: normal },
    uRegion: { value: new THREE.Vector4(X_MIN, Z_MIN, WIDTH_KM, HEIGHT_KM) },
    uFade: { value: 0 },
    uLift: { value: 0.001 },
    uPxK: { value: 0.001 },
  };
}

type Shared = ReturnType<typeof sharedUniforms>;

function paintMaterial(shared: Shared, appear: { value: number }, vertexShader: string, fragmentShader: string) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    fog: true,
    transparent: true,
    depthWrite: false,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...shared, uAppear: appear },
  });
}

interface Tile {
  key: number;
  ix: number;
  iz: number;
  /** 0 waiting, 1 loading, 2 ready, 3 failed */
  status: number;
  group: THREE.Group | null;
  trees: Float32Array | null;
  appear: { value: number };
  /** when it was last wanted (ms) */
  seen: number;
  failedAt: number;
}

class TreePool {
  readonly round: THREE.InstancedMesh;
  readonly cone: THREE.InstancedMesh;
  last = { x: 1e9, z: 1e9, r: 0, version: -1 };

  constructor(readonly capacity: number) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mk = (conical: boolean) => {
      const m = new THREE.InstancedMesh(crownGeometry(conical), mat, capacity);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      m.count = 0;
      m.frustumCulled = false;
      return m;
    };
    this.round = mk(false);
    this.cone = mk(true);
  }
}

interface State {
  worker: Worker | null;
  index: TileIndex | null;
  have: Set<number>;
  tiles: Map<number, Tile>;
  inflight: number;
  /** when tiles were last picked (ms) */
  picked: number;
  /** bumped whenever the set of trees on offer changes */
  version: number;
  shared: Shared;
  pool: TreePool;
  cars: CarSim;
  ground: HeightField;
  deck: DeckFinder | null;
  lowPower: boolean;
}

const m4 = new THREE.Matrix4();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const quat = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);

function makeRoot(scene: PreparedScene): THREE.Group {
  const root = new THREE.Group();
  const shared = sharedUniforms(scene.tex.normal);
  const pool = new TreePool(scene.lowPower ? 5000 : 16000);
  root.add(pool.round, pool.cone);
  const cars = new CarSim(scene.lowPower ? 350 : 1400);
  root.add(cars.root);
  // Stand-ins that are never seen, so the tiles' shaders compile with the rest of the scene.
  const dummy = new THREE.BufferGeometry();
  dummy.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
  dummy.setAttribute("aShape", new THREE.BufferAttribute(new Float32Array(12), 4));
  dummy.setAttribute("aLine", new THREE.BufferAttribute(new Float32Array(9), 3));
  dummy.setAttribute("aKind", new THREE.BufferAttribute(new Float32Array(3), 1));
  dummy.setAttribute("aInfo", new THREE.BufferAttribute(new Float32Array(12), 4));
  dummy.setAttribute("aU", new THREE.BufferAttribute(new Float32Array(3), 1));
  const none = { value: 0 };
  for (const mat of [
    paintMaterial(shared, none, ribbonVertex, ribbonFragment),
    paintMaterial(shared, none, areaVertex, areaFragment),
    makeBuildingMaterial(0),
  ]) {
    const m = new THREE.Mesh(dummy, mat);
    m.frustumCulled = false;
    root.add(m);
  }
  const state: State = {
    worker: null,
    index: null,
    have: new Set(),
    tiles: new Map(),
    inflight: 0,
    picked: 0,
    version: 0,
    shared,
    pool,
    cars,
    ground: scene.ground,
    deck: scene.central ? makeDeckFinder(scene.central.data, scene.ground) : null,
    lowPower: scene.lowPower,
  };
  root.userData.state = state;
  return root;
}

/**
 * Once a tile's buffers are on the GPU nothing reads them again: let the CPU copies go. The
 * renderer uploads a geometry before it computes a missing bounding sphere, so that comes first.
 */
function freeAfterUpload(geo: THREE.BufferGeometry) {
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  const free = function (this: { array: unknown }) {
    this.array = null;
  };
  for (const a of Object.values(geo.attributes)) (a as THREE.BufferAttribute).onUpload(free);
  geo.index?.onUpload(free);
}

/** Turn a tile's arrays into meshes under one group. */
function tileGroup(m: TileMeshes, st: State, appear: { value: number }): THREE.Group {
  const g = new THREE.Group();
  if (m.areas) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(m.areas.position, 3));
    geo.setAttribute("aKind", new THREE.BufferAttribute(m.areas.kind, 1));
    geo.setIndex(new THREE.BufferAttribute(m.areas.index, 1));
    freeAfterUpload(geo);
    const mesh = new THREE.Mesh(geo, paintMaterial(st.shared, appear, areaVertex, areaFragment));
    mesh.renderOrder = -2;
    mesh.frustumCulled = false;
    g.add(mesh);
  }
  if (m.streets) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(m.streets.position, 3));
    geo.setAttribute("aShape", new THREE.BufferAttribute(m.streets.shape, 4));
    geo.setAttribute("aLine", new THREE.BufferAttribute(m.streets.line, 3));
    geo.setIndex(new THREE.BufferAttribute(m.streets.index, 1));
    freeAfterUpload(geo);
    const mesh = new THREE.Mesh(geo, paintMaterial(st.shared, appear, ribbonVertex, ribbonFragment));
    mesh.renderOrder = -1;
    mesh.frustumCulled = false;
    g.add(mesh);
  }
  if (m.buildings) {
    const mat = makeBuildingMaterial(0);
    mat.uniforms.uGrow = appear;
    const geo = buildingGeometry(m.buildings);
    freeAfterUpload(geo);
    g.add(new THREE.Mesh(geo, mat));
  }
  return g;
}

function disposeGroup(g: THREE.Group) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  g.removeFromParent();
}

/** Refill the tree pool from the tiles in view, nearest first, thinning out with distance. */
function fillTrees(st: State, cam: typeof runtime.cam, visible: Tile[]) {
  const { pool } = st;
  const radius = Math.min(4.2, Math.max(0.9, cam.dist * 1.7));
  const last = pool.last;
  if (
    last.version === st.version &&
    Math.hypot(cam.x - last.x, cam.z - last.z) < radius * 0.12 &&
    Math.abs(radius - last.r) < last.r * 0.15
  ) {
    return;
  }
  last.x = cam.x;
  last.z = cam.z;
  last.r = radius;
  last.version = st.version;
  const r0 = radius * 0.4;
  let nr = 0;
  let nc = 0;
  const cap = pool.capacity;
  const size = st.index!.size;
  const [ox, oz] = st.index!.origin;
  const near = visible
    .filter((t) => t.trees)
    .map((t) => ({ t, d: Math.hypot(ox + (t.ix + 0.5) * size - cam.x, oz + (t.iz + 0.5) * size - cam.z) }))
    .sort((a, b) => a.d - b.d);
  for (const { t } of near) {
    const tr = t.trees!;
    for (let i = 0; i < tr.length; i += 5) {
      const x = tr[i];
      const z = tr[i + 2];
      const d = Math.hypot(x - cam.x, z - cam.z);
      if (d > radius) continue;
      const v = tr[i + 4];
      const conical = v >= 128;
      const tint = v % 128;
      // Beyond r0 only a share survives, falling off with distance, so the pool reaches further.
      if (d > r0 && ((tint * 0.61803 + x * 977) % 1) > (r0 / d) ** 2) continue;
      if (conical ? nc >= cap : nr >= cap) continue;
      const r = tr[i + 3] / 1000;
      quat.setFromAxisAngle(up, (tint / 127) * Math.PI * 2);
      pos.set(x, tr[i + 1] - 0.0004, z);
      scl.set(r, r * TREE_EXAG, r);
      m4.compose(pos, quat, scl);
      if (conical) {
        pool.cone.setMatrixAt(nc, m4);
        pool.cone.setColorAt(nc++, CONE[tint % CONE.length]);
      } else {
        pool.round.setMatrixAt(nr, m4);
        pool.round.setColorAt(nr++, ROUND[tint % ROUND.length]);
      }
    }
  }
  pool.round.count = nr;
  pool.cone.count = nc;
  for (const m of [pool.round, pool.cone]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}

export default function DetailTiles({ scene }: { scene: PreparedScene }) {
  const ref = useRef<THREE.Group>(null);
  const root = useMemo(() => makeRoot(scene), [scene]);

  useEffect(() => {
    const g = ref.current;
    if (!g) return;
    const st = g.userData.state as State;
    let cancelled = false;
    let worker: Worker;
    try {
      worker = new Worker(new URL("../../../lib/atlas/detail/worker.ts", import.meta.url), { type: "module" });
    } catch {
      return; // no workers: the map simply stays at its regional detail out here
    }
    worker.onmessage = (e: MessageEvent<{ type: string; key: number; meshes?: TileMeshes }>) => {
      st.inflight--;
      const tile = st.tiles.get(e.data.key);
      if (!tile) return;
      if (e.data.type !== "tile" || !e.data.meshes) {
        tile.status = 3;
        tile.failedAt = performance.now();
        return;
      }
      tile.group = tileGroup(e.data.meshes, st, tile.appear);
      tile.trees = e.data.meshes.trees;
      if (e.data.meshes.lanes) st.cars.addTile(tile.key, e.data.meshes.lanes, st.ground, st.deck);
      tile.status = 2;
      tile.appear.value = runtime.reducedMotion ? 1 : 0;
      g.add(tile.group);
      st.version++;
    };
    fetch("/atlas/tiles/index.json")
      .then((r) => (r.ok ? (r.json() as Promise<TileIndex>) : Promise.reject(new Error(String(r.status)))))
      .then((index) => {
        if (cancelled) return;
        const a = scene.assets;
        const fixed = [a.buildings, ...(scene.central ? [scene.central.footprints] : [])];
        const init: InitMessage = {
          type: "init",
          height: { width: a.height.width, height: a.height.height, data: a.height.data.slice() },
          segments: scene.terrainSegments,
          surface: { width: a.surface.width, height: a.surface.height, rgba: a.surface.rgba.slice() },
          density: { width: a.height.width, height: a.height.height, data: a.density.slice() },
          sdfLevels: a.meta.surface.sdfLevelsPerPx,
          surfPxM: (WIDTH_KM * 1000) / a.surface.width,
          fixed,
          size: index.size,
          origin: index.origin,
        };
        worker.postMessage(init);
        st.index = index;
        st.have = new Set(index.tiles.map(([ix, iz]) => tileKey(ix, iz)));
        st.worker = worker;
      })
      .catch((err) => console.warn("detail tiles unavailable:", err));
    return () => {
      cancelled = true;
      worker.terminate();
      st.worker = null;
      for (const t of st.tiles.values()) if (t.group) disposeGroup(t.group);
      st.tiles.clear();
      for (const m of [st.pool.round, st.pool.cone]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      st.cars.dispose();
    };
  }, [scene]);

  useFrame((state, dt) => {
    const g = ref.current;
    if (!g) return;
    const st = g.userData.state as State;
    if (!st.worker || !st.index) return;
    const persp = state.camera as THREE.PerspectiveCamera;
    const cam = runtime.cam;
    const now = performance.now();
    const maxDist = st.lowPower ? 4.6 : 8.5;
    const sh = st.shared;
    sh.uFade.value = 1 - THREE.MathUtils.smoothstep(cam.dist, maxDist * 0.78, maxDist);
    sh.uLift.value = 0.0008 + 0.00012 * cam.dist;
    // km per device pixel, per km of depth
    sh.uPxK.value = (2 * Math.tan((persp.fov * DEG) / 2)) / Math.max(1, state.size.height * state.gl.getPixelRatio());
    const on = cam.dist < maxDist;
    g.visible = on;
    if (!on) return;

    // Which tiles: a disc around what the camera looks at, pushed a little ahead of the target.
    const { size, origin } = st.index;
    const R = clamp(cam.dist * 1.35, 1.2, st.lowPower ? 3.2 : 6.5);
    const b = cam.bearing * DEG;
    const cx = cam.x + Math.sin(b) * R * 0.3;
    const cz = cam.z - Math.cos(b) * R * 0.3;
    if (now - st.picked > 150) {
      st.picked = now;
      const want: { t: Tile; d: number }[] = [];
      const ix0 = Math.floor((cx - R - origin[0]) / size);
      const ix1 = Math.floor((cx + R - origin[0]) / size);
      const iz0 = Math.floor((cz - R - origin[1]) / size);
      const iz1 = Math.floor((cz + R - origin[1]) / size);
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const key = tileKey(ix, iz);
          if (!st.have.has(key)) continue;
          const x0 = origin[0] + ix * size;
          const z0 = origin[1] + iz * size;
          const d = Math.hypot(Math.max(x0 - cx, 0, cx - x0 - size), Math.max(z0 - cz, 0, cz - z0 - size));
          if (d > R) continue;
          let t = st.tiles.get(key);
          if (!t) {
            t = { key, ix, iz, status: 0, group: null, trees: null, appear: { value: 0 }, seen: 0, failedAt: 0 };
            st.tiles.set(key, t);
          }
          t.seen = now;
          want.push({ t, d });
        }
      }
      want.sort((p, q) => p.d - q.d);
      for (const { t } of want) {
        if (st.inflight >= 4) break;
        if (t.status === 3 && now - t.failedAt > 20000) t.status = 0;
        if (t.status !== 0) continue;
        t.status = 1;
        st.inflight++;
        const worker = st.worker;
        fetch(`/atlas/tiles/${t.ix}_${t.iz}.bin`)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
          .then((buf) => {
            const msg: TileMessage = {
              type: "tile",
              key: t.key,
              buf,
              options: {
                size,
                x0: origin[0] + t.ix * size,
                z0: origin[1] + t.iz * size,
                treeSpacing: st.lowPower ? 18 : 13,
                minFootprint: st.lowPower ? 40 : 0,
              },
            };
            worker.postMessage(msg, [buf]);
          })
          .catch(() => {
            st.inflight--;
            t.status = 3;
            t.failedAt = performance.now();
          });
      }
      // Keep what was seen recently; beyond the cap, let the longest-unseen tiles go.
      const cap = st.lowPower ? 14 : 44;
      const ready = [...st.tiles.values()].filter((t) => t.status === 2);
      if (ready.length > cap) {
        ready.sort((p, q) => p.seen - q.seen);
        for (const t of ready.slice(0, ready.length - cap)) {
          if (now - t.seen < 2000) break;
          if (t.group) disposeGroup(t.group);
          st.cars.removeTile(t.key);
          st.tiles.delete(t.key);
          st.version++;
        }
      }
    }

    const step = runtime.reducedMotion ? 1 : Math.min(dt, 0.1) / 0.9;
    const visible: Tile[] = [];
    for (const t of st.tiles.values()) {
      if (t.status !== 2 || !t.group) continue;
      t.group.visible = now - t.seen < 1000;
      if (!t.group.visible) continue;
      visible.push(t);
      if (t.appear.value < 1) {
        t.appear.value = Math.min(1, t.appear.value + step);
        if (t.appear.value >= 1) st.version++; // up: its trees can join the pool
      }
    }
    fillTrees(st, cam, visible.filter((t) => t.appear.value >= 1));

    const carMax = st.lowPower ? 3.6 : 5.5;
    st.cars.root.visible = cam.dist < carMax;
    if (st.cars.root.visible) {
      st.cars.update(runtime.reducedMotion ? 0 : Math.min(dt, 0.1), cam, sky.uNight.value, sh.uLift.value, st.lowPower);
    }
  });

  return <primitive ref={ref} object={root} />;
}
