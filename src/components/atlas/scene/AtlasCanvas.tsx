"use client";

import { Children, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { sky } from "@/lib/atlas/timeOfDay";
import { groundY, type HeightField } from "@/lib/atlas/geo";
import { mark } from "@/lib/atlas/perf";
import { runtime, useAtlas } from "@/lib/atlas/store";
import Terrain, { CentralTerrain } from "./Terrain";
import Sky from "./Sky";
import Buildings from "./Buildings";
import { MapLines, clipLines } from "./Lines";
import TownLights from "./TownLights";
import Beacons from "./Beacons";
import RedLine from "./RedLine";
import CameraDirector from "./CameraDirector";
import Bats from "./Bats";
import Plume from "./Plume";
import SiteModels from "./SiteModels";
import Traffic from "./Traffic";
import RiverLife from "./RiverLife";
import ParkLife from "./ParkLife";
import CityLife from "./CityLife";
import Paddle from "./Paddle";
import Trees from "./Trees";
import Structures from "./Structures";
import Landmarks from "./Landmarks";
import DetailTiles from "./DetailTiles";
import Airport from "./Airport";
import Clouds from "./Clouds";
import WaterReflection, { mirrored } from "./Water";
import Occlusion from "./Occlusion";
import Construction from "./Construction";
import { LabelDriver } from "../ui/labels";
import type { PreparedScene } from "./prepare";

/** Light for three's own materials (landmarks, trees, the train, bats and plume). */
const GROUND_DAY = new THREE.Color("#8a7a66");
const GROUND_NIGHT = new THREE.Color("#15130f");
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _c = new THREE.Vector3();

/**
 * The sun and the sky's light, and the sun's shadows: an orthographic box around what the camera
 * looks at, sized to the view in steps (sharp up close, broad from afar), its centre snapped to
 * whole shadow-map texels so shadow edges hold still. Redrawing the map draws the city again, so
 * it's redrawn only when the view has moved a good way across the box, zoomed a step or the sun
 * has turned a little, and now and then while still (for what streams in); in between the box
 * stays put and the shadows in it stay right.
 */
function Lights({ ground, lowPower }: { ground: HeightField; lowPower: boolean }) {
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const last = useRef({ x: NaN, z: NaN, r: 0, sx: 0, sy: 0, sz: 0, frames: 0 });
  const mapSize = lowPower ? 1024 : 2048;
  useFrame((state) => {
    const n = sky.uNight.value;
    if (hemi.current) {
      hemi.current.color.copy(sky.uAmbient.value);
      // The light bounced off the ground goes dark with the ground, or walls glow beige at night.
      hemi.current.groundColor.copy(GROUND_DAY).lerp(GROUND_NIGHT, n);
      hemi.current.intensity = 1.6 - n * 1.1;
    }
    const s = sun.current;
    if (!s) return;
    if (s.shadow.mapSize.x !== mapSize) {
      s.shadow.mapSize.set(mapSize, mapSize);
      s.shadow.bias = -0.00022;
      s.shadow.radius = 2.4;
      s.shadow.map?.dispose();
      s.shadow.map = null;
      last.current.x = NaN;
    }
    s.color.copy(sky.uSunColor.value);
    s.intensity = 2.2 * (1 - n);
    const dir = sky.uSunDir.value;
    // No sun, no shadows (the map stays compiled for them, so nothing recompiles at dusk).
    s.shadow.intensity = THREE.MathUtils.smoothstep(dir.y, 0.02, 0.12) * (1 - n) * 0.9;
    const cam = runtime.cam;
    const want = THREE.MathUtils.clamp(cam.dist * 1.05, 0.35, 7);
    const r = Math.min(7, 0.35 * Math.pow(1.25, Math.ceil(Math.log(want / 0.35) / Math.log(1.25) - 1e-9)));
    // A little toward the camera from what it looks at: the near ground fills more of the screen.
    const b = THREE.MathUtils.degToRad(cam.bearing);
    _c.set(cam.x - Math.sin(b) * r * 0.25, 0, cam.z + Math.cos(b) * r * 0.25);
    _c.y = groundY(ground, _c.x, _c.z);
    // Snap to texels in the light's frame (three's lookAt: x = up × dir, y = dir × x).
    _x.crossVectors(WORLD_UP, dir).normalize();
    _y.crossVectors(dir, _x);
    const texel = (2 * r) / mapSize;
    const a = Math.round(_c.dot(_x) / texel) * texel;
    const bb = Math.round(_c.dot(_y) / texel) * texel;
    const d = _c.dot(dir);
    _c.copy(_x).multiplyScalar(a).addScaledVector(_y, bb).addScaledVector(dir, d);
    const l = last.current;
    const moved =
      Math.hypot(_c.x - l.x, _c.z - l.z) > r * 0.08 ||
      r !== l.r ||
      Math.abs(dir.x - l.sx) + Math.abs(dir.y - l.sy) + Math.abs(dir.z - l.sz) > 0.012;
    if (!moved && !Number.isNaN(l.x) && ++l.frames < 45) return;
    // The light takes its new place only as the map is redrawn: until then its old box and old
    // map stay together.
    s.target.position.copy(_c);
    s.target.updateMatrixWorld();
    s.position.copy(_c).addScaledVector(dir, 20);
    const sc = s.shadow.camera;
    if (sc.right !== r) {
      sc.left = -r;
      sc.right = r;
      sc.top = r;
      sc.bottom = -r;
      sc.near = 14;
      sc.far = 26;
      sc.updateProjectionMatrix();
    }
    state.gl.shadowMap.needsUpdate = s.shadow.intensity > 0.001;
    Object.assign(l, { x: _c.x, z: _c.z, r, sx: dir.x, sy: dir.y, sz: dir.z, frames: 0 });
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={["#ffffff", "#8a7a66", 1.4]} onUpdate={mirrored} />
      <directionalLight ref={sun} position={[20, 40, 10]} intensity={2} castShadow onUpdate={mirrored} />
    </>
  );
}

/**
 * Rendering the poster (scripts/atlas/render_poster.py): the page gets a way to draw one frame
 * and hand back its pixels, which is far quicker than a browser screenshot of a big canvas.
 */
function CaptureHook() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (!runtime.poster) return;
    (window as unknown as { __atlasCapture: () => string }).__atlasCapture = () => {
      gl.render(scene, camera);
      return gl.domElement.toDataURL("image/png");
    };
  }, [gl, scene, camera]);
  return null;
}

/** `?debug` exposes the renderer, scene and runtime state on window.__atlas, for measuring draw costs. */
function DebugHandle() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("debug")) {
      (window as unknown as { __atlas: unknown }).__atlas = { gl, scene, camera, runtime };
    }
  }, [gl, scene, camera]);
  return null;
}

/**
 * Reveals the live map once the scene has actually drawn, not just mounted: the city the atlas
 * opens on, so not before central Austin's detail is in (or has failed to load) and its shaders
 * have compiled, and its detail tiles in view (for at most 0.6 s more), so it matches the
 * opening poster.
 */
function ReadySignal({ settled }: { settled: boolean }) {
  const frames = useRef(0);
  const first = useRef(true);
  const since = useRef(0);
  useFrame(() => {
    if (first.current) {
      first.current = false;
      mark("first frame");
    }
    if (frames.current < 0 || !settled || runtime.compiling) return;
    since.current ||= performance.now();
    // (The tiles the opening view wants are at the far edge of the picture: they can fade in.)
    if (!runtime.tilesSettled && performance.now() - since.current < 600) return;
    if (++frames.current >= 2) {
      frames.current = -1;
      mark("ready");
      useAtlas.getState().setReady();
    }
  });
  return null;
}

/**
 * Keeps the map smooth on weaker GPUs: from the moment the live map appears, if the typical
 * frame (the median of the last 40, so a hitch as a tile or a piece arrives doesn't count) stays
 * slower than ~42 fps for most of a second, quality steps down, one step at a time
 * (runtime.quality): no contact shadows, then no lake reflections, then a pixel ratio of 1.25,
 * then 1. It never steps back up. Automated renders (the posters, QA screenshots) keep full
 * quality however slowly they draw.
 */
function Governor() {
  const ready = useAtlas((s) => s.ready);
  const st = useRef({ times: new Float32Array(40), n: 0, slow: 0, since: 0 });
  useFrame((state, dt) => {
    if (!ready || runtime.poster || runtime.quality >= 4 || navigator.webdriver || document.hidden) return;
    const s = st.current;
    const now = performance.now();
    s.since ||= now;
    s.times[s.n++ % s.times.length] = Math.min(dt, 0.25) * 1000;
    // A moment after the reveal and after each step, then judge by the typical frame.
    if (now - s.since < 500 || s.n < s.times.length) return;
    const median = [...s.times].sort((a, b) => a - b)[s.times.length >> 1];
    s.slow = median > 24 ? s.slow + dt : Math.max(0, s.slow - dt);
    if (s.slow < 0.8) return;
    runtime.quality++;
    const dpr = runtime.quality === 3 ? 1.25 : runtime.quality === 4 ? 1 : 0;
    if (dpr && state.viewport.dpr > dpr) state.setDpr(dpr);
    Object.assign(s, { n: 0, slow: 0, since: now });
  });
  return null;
}

/**
 * Compile an object's materials (three's compileAsync, in the background where the browser has
 * KHR_parallel_shader_compile) and resolve once they're ready to draw. Unlike compileAsync, a
 * material that goes away meanwhile (a tile dropped, a piece rebuilt) doesn't leave it waiting
 * forever, and it stops waiting after a few seconds whatever happens.
 */
function compiled(gl: THREE.WebGLRenderer, object: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene | null = null): Promise<void> {
  let materials: Set<THREE.Material>;
  try {
    materials = gl.compile(object, camera, scene);
  } catch {
    return Promise.resolve();
  }
  const started = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      for (const m of materials) {
        const program = (gl.properties.get(m) as { currentProgram?: { isReady(): boolean } }).currentProgram;
        try {
          if (!program || program.isReady()) materials.delete(m);
        } catch {
          materials.delete(m);
        }
      }
      if (materials.size === 0 || performance.now() - started > 6000) resolve();
      else setTimeout(check, 10);
    };
    setTimeout(check, 0);
  });
}

/**
 * Compile every material in the scene, visible or not, whenever its contents change, in the
 * background, and draw nothing new until it's done (Render): drawing with a shader still
 * compiling would stop the page dead until it was. Without this each layer would also compile
 * the first time it came into view (zooming into downtown, the first night).
 */
function Precompile({ token }: { token: unknown }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let live = true;
    runtime.compiling = true;
    compiled(gl, scene, camera).then(() => {
      if (live) runtime.compiling = false;
    });
    return () => {
      live = false;
      runtime.compiling = false;
    };
  }, [gl, scene, camera, token]);
  return null;
}

/**
 * Draws each frame, unless the scene's shaders are still compiling (Precompile): only ever while
 * the live map is still hidden behind the poster.
 */
function Render() {
  useFrame((state) => {
    if (!runtime.compiling) state.gl.render(state.scene, state.camera);
  }, 1);
  return null;
}

/**
 * Mounted hidden, shown once its shaders have compiled in the background (with
 * KHR_parallel_shader_compile): the map keeps drawing meanwhile, where drawing it at once would
 * stop the page until they had.
 */
function Compiled({ children }: { children: ReactNode }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const ref = useRef<THREE.Group>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const g = ref.current;
    if (!g) return;
    let live = true;
    compiled(gl, g, camera, scene).then(() => {
      if (live) setShown(true);
    });
    return () => {
      live = false;
    };
  }, [gl, scene, camera]);
  return (
    <group ref={ref} visible={shown}>
      {children}
    </group>
  );
}

/**
 * What the opening view doesn't need (traffic, life on the lake and in the parks and streets, the
 * bats, the airport, the town lights, the launch plume): built only once the live map is up and
 * has faded in, a piece at a time, each shown once compiled, so none of it is in the way of the
 * first reveal or stutters the map after it.
 */
function Later({ children }: { children: ReactNode }) {
  const ready = useAtlas((s) => s.ready);
  const items = Children.toArray(children);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!ready || n >= items.length) return;
    // After the live map has faded in over the poster (1.4 s), then a piece at a time, each when
    // the browser has a moment to spare (or within half a second regardless).
    let idle = 0;
    const next = () => setN((k) => k + 1);
    const t = setTimeout(() => {
      if (typeof requestIdleCallback === "function") idle = requestIdleCallback(next, { timeout: 500 });
      else next();
    }, n === 0 ? 1600 : 150);
    return () => {
      clearTimeout(t);
      if (idle) cancelIdleCallback(idle);
    };
  }, [ready, n, items.length]);
  return (
    <>
      {items.slice(0, n).map((item, i) => (
        <Compiled key={i}>{item}</Compiled>
      ))}
    </>
  );
}

export default function AtlasCanvas({ scene, settled }: { scene: PreparedScene; settled: boolean }) {
  const setWebglFailed = useAtlas((s) => s.setWebglFailed);
  // Up to 1.5 device pixels a CSS pixel: past that the extra sharpness isn't worth the GPU time
  // (a Retina laptop at 2 has 1.8x the pixels to shade).
  const dpr = useMemo<[number, number]>(() => [1, 1.5], []);
  const { assets, tex, buildings, ground, central } = scene;
  const highways = useMemo(() => clipLines([...assets.vectors.roads.motorway, ...assets.vectors.roads.trunk]), [assets]);

  return (
    <Canvas
      flat
      shadows={{ enabled: true, type: THREE.PCFShadowMap, autoUpdate: false }}
      dpr={dpr}
      camera={{ fov: 32, near: 0.05, far: 500, position: [0, 70, 60] }}
      gl={{ antialias: true, powerPreference: "high-performance", alpha: false, stencil: false }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", () => setWebglFailed(), { once: true });
      }}
      style={{ position: "fixed", inset: 0 }}
    >
      <CameraDirector height={ground} />
      <Lights ground={ground} lowPower={scene.lowPower} />
      <Sky />
      <Terrain tex={tex} segments={scene.terrainSegments} cutout={!!central} outer={assets.meta.outer?.bounds} />
      {central && (
        <CentralTerrain tex={central.tex} baseTex={tex} grid={central.patch} sdfK={assets.meta.central.surface.sdfK} />
      )}
      <MapLines assets={assets} central={central?.data} ground={ground} />
      <Buildings geometry={buildings.geometry} />
      {central && <Buildings geometry={central.buildings.geometry} />}
      <RedLine vectors={assets.vectors} height={ground} />
      <Beacons height={ground} siteTop={scene.siteTop} />
      {central && (
        <>
          <Structures central={central.data} ground={ground} />
          <Landmarks central={central.data} ground={ground} />
          <Trees trees={central.trees} ground={ground} lowPower={scene.lowPower} />
          <Paddle central={central.data} ground={ground} />
          <DetailTiles scene={scene} />
        </>
      )}
      <Later>
        {central && <RiverLife central={central.data} ground={ground} lowPower={scene.lowPower} />}
        {!scene.lowPower && <Traffic lines={highways} height={ground} count={1400} />}
        {central && <CityLife central={central.data} ground={ground} lowPower={scene.lowPower} />}
        {central && <ParkLife central={central.data} ground={ground} lowPower={scene.lowPower} />}
        <TownLights assets={assets} lowPower={scene.lowPower} />
        {central && <Bats central={central.data} ground={ground} count={scene.lowPower ? 4000 : 12000} />}
        <Airport ground={ground} />
        <Plume height={ground} origin={scene.models.engine} />
      </Later>
      <Clouds ground={ground} lowPower={scene.lowPower} />
      <Occlusion ground={ground} lowPower={scene.lowPower} />
      {central && !scene.lowPower && <WaterReflection levels={central.water} skyline={central.skyline} />}
      <Construction ground={ground} />
      <SiteModels models={scene.models} />
      <LabelDriver />
      <Precompile token={central} />
      <Render />
      <DebugHandle />
      <ReadySignal settled={settled} />
      <Governor />
      <CaptureHook />
    </Canvas>
  );
}
