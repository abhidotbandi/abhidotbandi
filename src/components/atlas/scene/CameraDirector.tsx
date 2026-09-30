"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MapControls } from "@react-three/drei";
import * as THREE from "three";
import type { MapControls as MapControlsImpl } from "three-stdlib";
import {
  applyCam,
  camFromPose,
  cloneCam,
  dampCam,
  flight,
  smoothstep,
  wrapDeg,
  type CamState,
  type Flight,
} from "@/lib/atlas/camera";
import { tourOffset, viewFov } from "@/lib/atlas/framing";
import { clamp, groundY, X_MAX, X_MIN, Z_MAX, Z_MIN, type HeightField } from "@/lib/atlas/geo";
import { runtime, useAtlas } from "@/lib/atlas/store";
import { applyTimeOfDay, sky } from "@/lib/atlas/timeOfDay";
import { getTimeline } from "@/lib/atlas/tour";
import { updateSiteState } from "./siteState";

const target = new THREE.Vector3();

export default function CameraDirector({ height }: { height: HeightField }) {
  const mode = useAtlas((s) => s.mode);
  const controls = useRef<MapControlsImpl>(null);
  const desired = useRef<CamState>(cloneCam(runtime.cam));
  const fly = useRef<{ f: Flight; t: number; dur: number } | null>(null);
  const rideFly = useRef<{ f: Flight; t: number; dur: number; from: CamState } | null>(null);
  const lastMode = useRef(mode);
  /** the MapControls instance that has been handed the current view */
  const handedOff = useRef<MapControlsImpl | null>(null);
  const offset = useRef({ x: 0, y: 0 });
  /** the first frame starts exactly on the view (no fly-in), so it matches the poster */
  const started = useRef(false);
  const timeline = getTimeline();

  useFrame((state, rawDt) => {
    const camera = state.camera as THREE.PerspectiveCamera;
    const size = state.size;
    const dt = Math.min(rawDt, 0.1);
    sky.uTime.value = state.clock.elapsedTime;
    const cur = runtime.cam;
    const st = useAtlas.getState();

    // A flight belongs to the mode that started it. Checked here rather than in an effect so
    // a fly-to requested together with a mode switch (deep links, search) isn't cancelled.
    if (st.mode !== lastMode.current) {
      lastMode.current = st.mode;
      fly.current = null;
      rideFly.current = null;
    }

    const first = !started.current;
    started.current = true;
    if (st.mode === "tour") {
      const { tod, stop } = timeline.sample(runtime.scroll, desired.current);
      if (first) {
        Object.assign(cur, desired.current);
        runtime.tod = tod;
      }
      dampCam(cur, desired.current, runtime.reducedMotion ? 14 : 4.2, dt);
      runtime.tod += (tod - runtime.tod) * (1 - Math.exp(-5 * dt));
      st.setActiveStop(stop);
      applyCam(camera, cur, groundY(height, cur.x, cur.z));
    } else if (st.mode === "explore") {
      const c = controls.current;
      // New controls start aimed at the origin: hand them the current view first. Done here
      // rather than in an effect so no frame can read the pose back before the handoff.
      if (c && handedOff.current !== c) {
        handedOff.current = c;
        c.target.set(cur.x, groundY(height, cur.x, cur.z), cur.z);
        applyCam(camera, cur, c.target.y);
        c.update();
      }
      if (runtime.flyTo) {
        const f = flight(cloneCam(cur), runtime.flyTo);
        fly.current = { f, t: 0, dur: runtime.reducedMotion ? 0.01 : clamp(1.1 + f.S * 0.45, 1.2, 3.6) };
        runtime.flyTo = null;
      }
      if (fly.current) {
        const fl = fly.current;
        fl.t = Math.min(1, fl.t + dt / fl.dur);
        Object.assign(cur, fl.f.at(fl.t));
        const t = applyCam(camera, cur, groundY(height, cur.x, cur.z), target);
        if (c) c.target.copy(t);
        if (fl.t >= 1) fly.current = null;
      } else if (c) {
        // Keep the map in bounds, then read the pose back as our camera state.
        const tx = clamp(c.target.x, X_MIN, X_MAX);
        const tz = clamp(c.target.z, Z_MIN, Z_MAX);
        if (tx !== c.target.x || tz !== c.target.z) {
          const dx = tx - c.target.x;
          const dz = tz - c.target.z;
          c.target.x = tx;
          c.target.z = tz;
          camera.position.x += dx;
          camera.position.z += dz;
        }
        Object.assign(cur, camFromPose(camera.position, c.target));
      }
      // Reduced motion cuts to the new light, as it cuts the camera.
      runtime.tod += (st.exploreTod - runtime.tod) * (runtime.reducedMotion ? 1 : 1 - Math.exp(-2.5 * dt));
    } else {
      // Ride and paddle: chase the train (or the paddleboarder) from above and behind.
      const paddle = st.mode === "paddle";
      const tp = paddle ? runtime.paddlePos : runtime.trainPos;
      const hdg = tp.heading;
      const d = desired.current;
      const lead = paddle ? 0.1 : 0.18;
      d.x = tp.x + Math.sin(hdg) * lead;
      d.z = tp.z - Math.cos(hdg) * lead;
      d.dist = paddle ? 0.45 : 1.1;
      d.tilt = paddle ? 66 : 63;
      d.bearing = (hdg * 180) / Math.PI;
      // Big jumps (boarding, skipping stops) fly rather than drag the low camera across the map.
      const far = Math.hypot(d.x - cur.x, d.z - cur.z) > 1.5 || Math.abs(Math.log(cur.dist / d.dist)) > 1.5;
      if (far && !rideFly.current) {
        if (runtime.reducedMotion) {
          Object.assign(cur, d);
        } else {
          // Fly to a snapshot of the target; the train's progress since is added on top below.
          const from = cloneCam(d);
          const f = flight(cloneCam(cur), from);
          rideFly.current = { f, t: 0, dur: clamp(1.1 + f.S * 0.45, 1.2, 3.6), from };
        }
      }
      const fl = rideFly.current;
      if (fl) {
        fl.t = Math.min(1, fl.t + dt / fl.dur);
        // The train keeps moving during the flight; fold that in so the flight lands on it.
        const p = fl.f.at(fl.t);
        const k = smoothstep(fl.t);
        p.x += (d.x - fl.from.x) * k;
        p.z += (d.z - fl.from.z) * k;
        p.bearing += wrapDeg(d.bearing - fl.from.bearing) * k;
        Object.assign(cur, p);
        if (fl.t >= 1) rideFly.current = null;
      } else {
        dampCam(cur, d, 3, dt);
      }
      applyCam(camera, cur, groundY(height, cur.x, cur.z));
      // The ride is the morning commute, early light at Leander to full morning downtown; the
      // paddle runs through golden hour to reach the Congress Avenue Bridge as the bats come out.
      const want = paddle ? 0.74 + 0.16 * runtime.paddleS : 0.16 + 0.18 * runtime.rideS;
      runtime.tod += (want - runtime.tod) * (runtime.reducedMotion ? 1 : 1 - Math.exp(-1.5 * dt));
    }

    const poster = runtime.poster;
    camera.fov = poster ? poster.fov : viewFov(size.width, size.height);
    // Clip planes that follow the zoom level keep depth precision where it's needed.
    camera.near = Math.max(0.004, cur.dist * 0.006);
    camera.far = cur.dist * 9 + 90;

    // Shift the focal point to make room for story cards (desktop: right; phone: up, into the
    // open map above the card) and, while riding, for the HUD along the bottom.
    const wide = size.width >= 900;
    const tourShift = tourOffset(size.width, size.height);
    let wantX = st.mode === "tour" ? tourShift.x : st.selectedSite && wide ? -170 : 0;
    let wantY = st.mode === "tour" ? tourShift.y : st.mode === "ride" || st.mode === "paddle" ? Math.min(130, size.height * 0.15) : 0;
    if (poster) {
      wantX = poster.ppx - size.width / 2;
      wantY = size.height / 2 - poster.ppy;
    }
    const k = first || poster ? 1 : 1 - Math.exp(-4 * dt);
    offset.current.x += (wantX - offset.current.x) * k;
    offset.current.y += (wantY - offset.current.y) * k;
    runtime.viewOffset.x = offset.current.x;
    runtime.viewOffset.y = offset.current.y;
    if (Math.abs(offset.current.x) > 0.5 || Math.abs(offset.current.y) > 0.5) {
      camera.setViewOffset(size.width, size.height, -offset.current.x, offset.current.y, size.width, size.height);
    } else {
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();

    applyTimeOfDay(runtime.tod);
    sky.uCamPos.value.copy(camera.position);
    sky.uZoomOut.value = clamp((Math.log(cur.dist) - Math.log(4)) / (Math.log(80) - Math.log(4)), 0, 1);
    const fog = state.scene.fog as THREE.FogExp2 | null;
    if (fog) {
      fog.color.copy(sky.uHorizon.value);
      const d50 = cur.dist * 2.1 + 22;
      // Clear air by day, so the colour carries into the distance; hazier at night.
      fog.density = (0.83 / d50) * (0.8 + 0.55 * sky.uNight.value);
      sky.uFogDensity.value = fog.density;
      sky.uFogColor.value.copy(fog.color).convertLinearToSRGB();
    }
    state.gl.setClearColor(sky.uGround.value);
    updateSiteState({
      mode: st.mode,
      activeStop: st.activeStop,
      selected: st.selectedSite,
      hovered: st.hoveredSite,
      domains: st.domains,
      defenseOnly: st.defenseOnly,
      night: sky.uNight.value,
    });
  }, -1);

  return (
    <>
      <fogExp2 attach="fog" args={["#e9dfcc", 0.01]} />
      {mode === "explore" && (
        <MapControls
          ref={controls}
          makeDefault
          enableDamping
          dampingFactor={0.09}
          screenSpacePanning={false}
          minDistance={0.18}
          maxDistance={150}
          maxPolarAngle={1.32}
          zoomSpeed={1.1}
          onStart={() => {
            fly.current = null;
          }}
        />
      )}
    </>
  );
}
