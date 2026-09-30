"use client";

import { useEffect, useMemo, useRef } from "react";
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
import WaterReflection from "./Water";
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
 * looks at, sized to the view (sharp up close, broad from afar), its centre snapped to whole
 * shadow-map texels so shadow edges hold still as the camera moves. The map is redrawn when the
 * view or the sun moves, and a few times a second otherwise.
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
    const r = THREE.MathUtils.clamp(cam.dist * 1.05, 0.35, 7);
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
    const l = last.current;
    const moved =
      Math.abs(_c.x - l.x) > texel * 0.5 ||
      Math.abs(_c.z - l.z) > texel * 0.5 ||
      Math.abs(r - l.r) > 1e-6 ||
      Math.abs(dir.x - l.sx) + Math.abs(dir.y - l.sy) + Math.abs(dir.z - l.sz) > 1e-4;
    // Also a few times a second while still: buildings, tiles and trees stream in under a
    // camera that isn't moving.
    if (moved || Number.isNaN(l.x) || ++l.frames > 20) {
      state.gl.shadowMap.needsUpdate = s.shadow.intensity > 0.001;
      Object.assign(l, { x: _c.x, z: _c.z, r, sx: dir.x, sy: dir.y, sz: dir.z, frames: 0 });
    }
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={["#ffffff", "#8a7a66", 1.4]} />
      <directionalLight ref={sun} position={[20, 40, 10]} intensity={2} castShadow />
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
 * opens on, so not before central Austin's detail is in (or has failed to load), and its detail
 * tiles in view (for at most a couple of seconds more), so it matches the opening poster.
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
    if (frames.current < 0 || !settled) return;
    since.current ||= performance.now();
    if (!runtime.tilesSettled && performance.now() - since.current < 2500) return;
    if (++frames.current >= 2) {
      frames.current = -1;
      mark("ready");
      useAtlas.getState().setReady();
    }
  });
  return null;
}

/**
 * Keeps the map smooth on weaker GPUs: if frames stay slow (under ~35 fps) for a couple of
 * seconds once the map is up, the costliest extras go, one step at a time: the lakes'
 * reflections, then the contact shadows, then the pixel ratio drops to 1. It never steps back
 * up. Automated renders (the posters, QA screenshots) keep full quality however slowly they draw.
 */
function Governor() {
  const ready = useAtlas((s) => s.ready);
  const st = useRef({ ema: 16, slow: 0, since: 0 });
  useFrame((state, dt) => {
    if (!ready || runtime.poster || runtime.quality >= 3 || navigator.webdriver || document.hidden) return;
    const s = st.current;
    const now = performance.now();
    s.since ||= now;
    // Let the reveal (and each step down) settle before judging.
    if (now - s.since < 3000) return;
    // A smoothed frame time, so one hitch (a shader compiling, a tile arriving) doesn't count;
    // then how long it has stayed slow.
    s.ema += (Math.min(dt, 0.1) * 1000 - s.ema) * 0.05;
    s.slow = s.ema > 28 ? s.slow + dt : Math.max(0, s.slow - dt);
    if (s.slow < 2) return;
    runtime.quality++;
    if (runtime.quality === 3) state.setDpr(1);
    Object.assign(s, { ema: 16, slow: 0, since: now });
  });
  return null;
}

/**
 * Compile every material in the scene, visible or not, whenever its contents change. Without this
 * each layer compiles the first time it comes into view (zooming into downtown, the first night),
 * stalling that frame; with KHR_parallel_shader_compile it happens off the main thread.
 */
function Precompile({ token }: { token: unknown }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    gl.compileAsync(scene, camera).catch(() => {});
  }, [gl, scene, camera, token]);
  return null;
}

export default function AtlasCanvas({ scene, settled }: { scene: PreparedScene; settled: boolean }) {
  const setWebglFailed = useAtlas((s) => s.setWebglFailed);
  const dpr = useMemo<[number, number]>(() => [1, scene.lowPower ? 1.5 : 2], [scene.lowPower]);
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
      <TownLights assets={assets} lowPower={scene.lowPower} />
      {central && (
        <CentralTerrain tex={central.tex} baseTex={tex} grid={central.patch} sdfK={assets.meta.central.surface.sdfK} />
      )}
      <MapLines assets={assets} central={central?.data} ground={ground} />
      <Buildings geometry={buildings.geometry} />
      {central && <Buildings geometry={central.buildings.geometry} />}
      <RedLine vectors={assets.vectors} height={ground} />
      <Beacons height={ground} siteTop={scene.siteTop} />
      {!scene.lowPower && <Traffic lines={highways} height={ground} count={1400} />}
      {central && (
        <>
          <Structures central={central.data} ground={ground} />
          <Landmarks central={central.data} ground={ground} />
          <Trees trees={central.trees} ground={ground} lowPower={scene.lowPower} />
          <RiverLife central={central.data} ground={ground} lowPower={scene.lowPower} />
          <ParkLife central={central.data} ground={ground} lowPower={scene.lowPower} />
          <CityLife central={central.data} ground={ground} lowPower={scene.lowPower} />
          <Paddle central={central.data} ground={ground} />
          <Bats central={central.data} ground={ground} count={scene.lowPower ? 4000 : 12000} />
          <DetailTiles scene={scene} />
        </>
      )}
      <Airport ground={ground} />
      <Clouds ground={ground} lowPower={scene.lowPower} />
      <Occlusion ground={ground} lowPower={scene.lowPower} />
      {central && !scene.lowPower && <WaterReflection levels={central.water} />}
      <Construction ground={ground} />
      <SiteModels models={scene.models} />
      <Plume height={ground} origin={scene.models.engine} />
      <LabelDriver />
      <Precompile token={central} />
      <DebugHandle />
      <ReadySignal settled={settled} />
      <Governor />
      <CaptureHook />
    </Canvas>
  );
}
