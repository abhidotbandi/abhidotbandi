"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { SiteModelSet } from "@/lib/atlas/siteModels";
import { runtime } from "@/lib/atlas/store";
import { sky } from "@/lib/atlas/timeOfDay";
import { siteUniforms } from "./siteState";

// The signature sites' models (built in siteModels.ts): lit like the buildings, with trim in the
// site's domain colour, the whole model taking on that colour when the site is picked or in
// focus, windows and floodlights after dark, blinking obstruction lights, and the sky in the
// solar arrays. Steam drifts off the fabs' cooling towers.

const vertex = /* glsl */ `
  attribute vec3 aColor;
  attribute vec2 aKind;
  varying vec3 vColor;
  varying vec2 vKind;
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vColor = aColor;
    vKind = aKind;
    vWorld = position;
    vec4 mvPosition = viewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uAmbient;
  uniform vec3 uCamPos;
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform float uNight;
  uniform float uTime;
  uniform vec4 uSite[64];
  varying vec3 vColor;
  varying vec2 vKind;
  varying vec3 vWorld;
  #include <fog_pars_fragment>

  float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

  void main() {
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    if (dot(n, uCamPos - vWorld) < 0.0) n = -n;
    vec4 site = vKind.x > -0.5 ? uSite[int(vKind.x + 0.5)] : vec4(0.0, 0.0, 0.0, -1.0);
    bool on = site.a > -0.5; // filtered out: plain materials, no trim
    float emph = on ? max(site.a, 0.0) : 0.0;
    float glow = vKind.y;
    bool windows = glow > 0.5 && glow < 1.5;
    bool accent = glow > 1.5 && glow < 2.5;
    bool beacon = glow > 2.5 && glow < 3.5;
    bool lamp = glow > 3.5 && glow < 4.5;
    bool solar = glow > 4.5;

    vec3 base = vColor;
    if (accent && on) base = site.rgb;
    vec3 view = normalize(uCamPos - vWorld);
    if (solar || windows) {
      float fres = pow(1.0 - max(dot(view, n), 0.0), 4.0);
      base = mix(base, mix(uHorizon, uZenith, 0.5), (solar ? 0.12 : 0.2) + 0.5 * fres);
    }
    // Picked, hovered or in the tour's focus: the model takes on its domain's colour.
    if (on) base = mix(base, site.rgb, 0.3 * smoothstep(0.55, 1.0, emph));

    float diff = max(dot(n, uSunDir), 0.0);
    vec3 col = base * (uAmbient * (0.6 + 0.4 * n.y) + uSunColor * diff * 0.55);
    col *= 1.0 - uNight * 0.84;

    float dark = smoothstep(0.35, 1.0, uNight);
    if (windows) {
      // Bays of lit windows every ~3 m, averaging out from afar before they can shimmer.
      float a = (vWorld.x + vWorld.z) * 1000.0 / 3.2;
      float lit = step(0.45, hash(floor(a)));
      float far = smoothstep(0.35, 1.1, fwidth(a));
      col += vec3(1.0, 0.62, 0.3) * mix(lit, 0.55, far) * dark * 0.8;
    }
    if (accent && on) col += site.rgb * uNight * (0.35 + 0.5 * emph);
    if (lamp) col += vec3(1.0, 0.86, 0.62) * (0.15 + 1.6 * dark);
    if (beacon) {
      float blink = step(0.55, fract(uTime * 0.75 + hash(floor(vWorld.x * 300.0)) * 0.3));
      col += vec3(1.0, 0.06, 0.03) * blink * (0.5 + 1.5 * uNight);
    }
    if (on) col += site.rgb * emph * (0.5 + 0.5 * sin(uTime * 3.0)) * 0.12 * smoothstep(0.9, 1.0, emph);
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

const steamVertex = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uPx;
  uniform float uFade;
  varying float vAlpha;
  void main() {
    // Puffs rise off the fans, spread and drift downwind (east), thinning as they go.
    float life = fract(uTime * 0.06 * (0.7 + aSeed.w * 0.6) + aSeed.x);
    float a = aSeed.y * 6.283;
    vec3 p = position + vec3(life * 0.035, 0.004 + life * 0.05, 0.0);
    p += vec3(cos(a), 0.0, sin(a)) * (0.002 + life * 0.012) * aSeed.z;
    vAlpha = uFade * (1.0 - life) * smoothstep(0.0, 0.12, life) * 0.45;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp((0.008 + life * 0.026) / (-mv.z) / uPx, 1.0, 140.0);
  }
`;

const steamFragment = /* glsl */ `
  uniform vec3 uLight;
  varying float vAlpha;
  void main() {
    float m = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5));
    if (m * vAlpha < 0.01) discard;
    gl_FragColor = vec4(uLight, m * vAlpha);
    #include <colorspace_fragment>
  }
`;

function makeSteam(outlets: Float32Array): THREE.Points | null {
  const n = outlets.length / 3;
  if (!n) return null;
  const per = 22;
  const pos = new Float32Array(n * per * 3);
  const seed = new Float32Array(n * per * 4);
  for (let i = 0; i < n * per; i++) {
    const o = Math.floor(i / per);
    pos.set([outlets[o * 3], outlets[o * 3 + 1], outlets[o * 3 + 2]], i * 3);
    seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
  const p = new THREE.Points(
    g,
    new THREE.ShaderMaterial({
      vertexShader: steamVertex,
      fragmentShader: steamFragment,
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: sky.uTime, uPx: { value: 0.001 }, uFade: { value: 0 }, uLight: { value: new THREE.Color() } },
    }),
  );
  p.frustumCulled = false;
  p.renderOrder = 30;
  // Where the towers are, for the distance check.
  p.userData.centres = Array.from({ length: n }, (_, o) => [outlets[o * 3], outlets[o * 3 + 2]]);
  return p;
}

export default function SiteModels({ models }: { models: SiteModelSet }) {
  const mesh = useRef<THREE.Mesh>(null);
  const steamRef = useRef<THREE.Points>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        fog: true,
        side: THREE.DoubleSide,
        uniforms: {
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          uSunColor: sky.uSunColor,
          uSunDir: sky.uSunDir,
          uAmbient: sky.uAmbient,
          uCamPos: sky.uCamPos,
          uHorizon: sky.uHorizon,
          uZenith: sky.uZenith,
          uNight: sky.uNight,
          uTime: sky.uTime,
          uSite: siteUniforms.uSite,
        },
      }),
    [],
  );
  const steam = useMemo(() => makeSteam(models.steam), [models]);

  useFrame((state) => {
    const m = mesh.current;
    if (m) m.visible = runtime.cam.dist < 60;
    const s = steamRef.current;
    if (!s) return;
    // Only near a fab: the nearest outlet within ~9 km, with the camera below ~12 km.
    let near = Infinity;
    for (const [x, z] of s.userData.centres as number[][]) near = Math.min(near, Math.hypot(runtime.cam.x - x, runtime.cam.z - z));
    const want = runtime.reducedMotion ? 0 : (1 - THREE.MathUtils.smoothstep(near, 6, 9)) * (1 - THREE.MathUtils.smoothstep(runtime.cam.dist, 8, 12));
    const u = (s.material as THREE.ShaderMaterial).uniforms;
    u.uFade.value += (want - u.uFade.value) * 0.08;
    s.visible = u.uFade.value > 0.005;
    const cam = state.camera as THREE.PerspectiveCamera;
    u.uPx.value = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / Math.max(1, state.size.height) / state.viewport.dpr;
    (u.uLight.value as THREE.Color).setRGB(0.95, 0.95, 0.94).lerp(sky.uAmbient.value, 0.35);
  });

  if (!models.geometry) return null;
  return (
    <group>
      <mesh ref={mesh} geometry={models.geometry} material={material} />
      {steam && <primitive ref={steamRef} object={steam} />}
    </group>
  );
}
