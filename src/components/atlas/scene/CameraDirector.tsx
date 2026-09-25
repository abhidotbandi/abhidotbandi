"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MapControls } from "@react-three/drei";
import * as THREE from "three";
import type { MapControls as MapControlsImpl } from "three-stdlib";
import {
  applyCam,
  camFromPose,
  cloneCam,
  dampCam,
  flight,
  type CamState,
  type Flight,
} from "@/lib/atlas/camera";
import { clamp, groundY, X_MAX, X_MIN, Z_MAX, Z_MIN, type RegionRaster } from "@/lib/atlas/geo";
import { runtime, useAtlas } from "@/lib/atlas/store";
import { applyTimeOfDay, sky } from "@/lib/atlas/timeOfDay";
import { getTimeline } from "@/lib/atlas/tour";
import { updateSiteState } from "./siteState";

const target = new THREE.Vector3();

export default function CameraDirector({ height }: { height: RegionRaster }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  const mode = useAtlas((s) => s.mode);
  const controls = useRef<MapControlsImpl>(null);
  const desired = useRef<CamState>(cloneCam(runtime.cam));
  const fly = useRef<{ f: Flight; t: number; dur: number } | null>(null);
  const offset = useRef({ x: 0, y: 0 });
  const timeline = getTimeline();

  useEffect(() => {
    scene.fog = new THREE.FogExp2(sky.uHorizon.value.clone(), 0.01);
    return () => {
      scene.fog = null;
    };
  }, [scene]);

  // Entering explore: hand the current view to the controls.
  useEffect(() => {
    if (mode !== "explore") return;
    const c = controls.current;
    if (!c) return;
    const cur = runtime.cam;
    c.target.set(cur.x, groundY(height, cur.x, cur.z), cur.z);
    applyCam(camera, cur, c.target.y);
    c.update();
  }, [mode, camera, height]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    sky.uTime.value = state.clock.elapsedTime;
    const cur = runtime.cam;
    const st = useAtlas.getState();

    if (st.mode === "tour") {
      const { tod, stop } = timeline.sample(runtime.scroll, desired.current);
      dampCam(cur, desired.current, runtime.reducedMotion ? 14 : 4.2, dt);
      runtime.tod += (tod - runtime.tod) * (1 - Math.exp(-5 * dt));
      st.setActiveStop(stop);
      applyCam(camera, cur, groundY(height, cur.x, cur.z));
    } else if (st.mode === "explore") {
      const c = controls.current;
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
      runtime.tod += (st.exploreTod - runtime.tod) * (1 - Math.exp(-2.5 * dt));
    } else {
      // Ride: chase the train from above and behind.
      const tp = runtime.trainPos;
      const hdg = tp.heading;
      desired.current.x = tp.x + Math.sin(hdg) * 0.18;
      desired.current.z = tp.z - Math.cos(hdg) * 0.18;
      desired.current.dist = 1.1;
      desired.current.tilt = 63;
      desired.current.bearing = (hdg * 180) / Math.PI;
      dampCam(cur, desired.current, 3, dt);
      applyCam(camera, cur, groundY(height, cur.x, cur.z));
    }

    // Clip planes that follow the zoom level keep depth precision where it's needed.
    camera.near = Math.max(0.004, cur.dist * 0.006);
    camera.far = cur.dist * 9 + 90;

    // Shift the focal point to make room for story cards (desktop: right; phone: up).
    const wide = size.width >= 900;
    const wantX = st.mode === "tour" && wide ? Math.min(250, size.width * 0.15) : st.selectedSite && wide ? -170 : 0;
    const wantY = st.mode === "tour" && !wide ? size.height * 0.17 : 0;
    const k = 1 - Math.exp(-4 * dt);
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
    const fog = scene.fog as THREE.FogExp2 | null;
    if (fog) {
      fog.color.copy(sky.uHorizon.value);
      const d50 = cur.dist * 2.1 + 22;
      fog.density = (0.83 / d50) * (1 + 0.35 * sky.uNight.value);
    }
    state.gl.setClearColor(sky.uHorizon.value);
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

  return mode === "explore" ? (
    <MapControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.09}
      screenSpacePanning={false}
      minDistance={0.35}
      maxDistance={150}
      maxPolarAngle={1.32}
      zoomSpeed={1.1}
      onStart={() => {
        fly.current = null;
      }}
    />
  ) : null;
}
