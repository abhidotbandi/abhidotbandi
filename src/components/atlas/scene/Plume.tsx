"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SITE_BY_ID } from "@/data/atlas/companies";
import { groundY, type RegionRaster } from "@/lib/atlas/geo";
import { runtime } from "@/lib/atlas/store";
import { sky } from "@/lib/atlas/timeOfDay";

const vertex = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uFire;
  uniform float uPx;
  uniform float uSmoke;
  varying float vHeat;
  varying float vAlpha;
  void main() {
    // Exhaust leaves the stand, hits the deflector and billows sideways and up.
    float life = fract(uTime * (uSmoke > 0.5 ? 0.12 : 1.4) * (0.7 + aSeed.w * 0.6) + aSeed.x);
    vec3 p = position;
    if (uSmoke > 0.5) {
      float a = aSeed.y * 6.283;
      p += vec3(0.08 + life * 0.5, 0.02 + life * 0.28, 0.0);
      p += vec3(cos(a), 0.0, sin(a)) * (0.03 + life * 0.18) * aSeed.z;
      vHeat = 0.0;
      vAlpha = uFire * (1.0 - life) * smoothstep(0.0, 0.08, life) * 0.55;
    } else {
      p += vec3(life * 0.09, -life * 0.012, (aSeed.y - 0.5) * 0.02 * life);
      vHeat = 1.0 - life;
      vAlpha = uFire * (1.0 - life);
    }
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float worldSize = uSmoke > 0.5 ? 0.05 + life * 0.14 : 0.03 * (1.0 - life * 0.5);
    gl_PointSize = clamp(worldSize / (-mv.z) / uPx, 1.0, 180.0);
  }
`;

const fragment = /* glsl */ `
  uniform float uSmoke;
  uniform vec3 uLight;
  varying float vHeat;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float m = smoothstep(0.5, 0.15, r);
    if (m * vAlpha < 0.01) discard;
    vec3 c = uSmoke > 0.5 ? uLight : mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.95, 0.8), vHeat);
    gl_FragColor = vec4(c, m * vAlpha);
    #include <colorspace_fragment>
  }
`;

function points(n: number, origin: THREE.Vector3): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    pos.set([origin.x, origin.y, origin.z], i * 3);
    seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
  }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
  return g;
}

/** Firefly's Rocket Ranch: an engine on the test stand, firing on a loop at the Briggs stop. */
export default function Plume({ height }: { height: RegionRaster }) {
  const smoke = useRef<THREE.Points>(null);
  const flame = useRef<THREE.Points>(null);
  const site = SITE_BY_ID.get("firefly-ranch")!;
  const { origin, smokeGeo, flameGeo, smokeMat, flameMat } = useMemo(() => {
    // The test stands sit east of the main shop buildings.
    const x = site.x + 0.55;
    const z = site.z - 0.25;
    const origin = new THREE.Vector3(x, groundY(height, x, z) + 0.035, z);
    const shared = () => ({ uTime: sky.uTime, uFire: { value: 0 }, uPx: { value: 0.001 } });
    const smokeMat = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      uniforms: { ...shared(), uSmoke: { value: 1 }, uLight: { value: new THREE.Color("#f4efe6") } },
    });
    const flameMat = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { ...shared(), uSmoke: { value: 0 }, uLight: { value: new THREE.Color("#ffffff") } },
    });
    return { origin, smokeGeo: points(260, origin), flameGeo: points(160, origin), smokeMat, flameMat };
  }, [height, site]);

  useFrame((state) => {
    const s = smoke.current;
    const f = flame.current;
    if (!s || !f) return;
    const cam = state.camera as THREE.PerspectiveCamera;
    const near = Math.hypot(runtime.cam.x - origin.x, runtime.cam.z - origin.z) < 5 && runtime.cam.dist < 8;
    // A 9 s burn every 16 s.
    const cyc = state.clock.elapsedTime % 16;
    const burn = near && !runtime.reducedMotion ? THREE.MathUtils.smoothstep(cyc, 0, 0.6) * (1 - THREE.MathUtils.smoothstep(cyc, 8.4, 9)) : 0;
    const px = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / Math.max(1, state.size.height) / state.viewport.dpr;
    for (const p of [s, f]) {
      const u = (p.material as THREE.ShaderMaterial).uniforms;
      u.uFire.value += (burn - u.uFire.value) * 0.1;
      u.uPx.value = px;
      p.visible = u.uFire.value > 0.005;
    }
    ((s.material as THREE.ShaderMaterial).uniforms.uLight.value as THREE.Color)
      .setRGB(0.95, 0.93, 0.9)
      .lerp(sky.uAmbient.value, 0.4);
  });

  return (
    <group>
      <points ref={smoke} geometry={smokeGeo} material={smokeMat} frustumCulled={false} renderOrder={31} />
      <points ref={flame} geometry={flameGeo} material={flameMat} frustumCulled={false} renderOrder={32} />
    </group>
  );
}
