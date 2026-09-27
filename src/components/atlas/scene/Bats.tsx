"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { groundY, project, type HeightField } from "@/lib/atlas/geo";
import { runtime } from "@/lib/atlas/store";
import { sky } from "@/lib/atlas/timeOfDay";

// Congress Avenue Bridge, where the colony roosts in the expansion joints.
const [BX, BZ] = project(-97.74516, 30.26175);

const vertex = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uShow;
  uniform vec3 uOrigin;
  varying float vAlpha;
  #include <fog_pars_vertex>

  void main() {
    // Each bat loops: pour out from under the bridge, spiral up, then stream east-southeast to feed.
    float speed = 0.014 + aSeed.w * 0.01;
    float life = fract(uTime * speed + aSeed.x);
    vec3 start = uOrigin + vec3((aSeed.z - 0.5) * 0.03, 0.0, (aSeed.y - 0.5) * 0.24);
    float swirl = smoothstep(0.0, 0.18, life);
    float a = life * 40.0 + aSeed.x * 6.283;
    vec3 col = vec3(cos(a), 0.0, sin(a)) * 0.05 * swirl * (1.0 - smoothstep(0.15, 0.3, life));
    vec3 dir = normalize(vec3(1.0, 0.0, 0.42));
    vec3 side = vec3(-dir.z, 0.0, dir.x);
    float travel = smoothstep(0.08, 1.0, life) * 4.5;
    float ribbon = sin(travel * 1.6 + aSeed.y * 3.0) * 0.12 + (aSeed.z - 0.5) * (0.08 + travel * 0.08);
    vec3 p = start + col + dir * travel + side * ribbon;
    p.y += 0.012 + smoothstep(0.0, 0.25, life) * 0.12 + travel * 0.03 + sin(travel * 2.0 + aSeed.w * 6.0) * 0.015;

    // Flap: wing tips (position.y marks them) beat fast.
    vec3 local = position;
    local.y *= sin(uTime * (22.0 + aSeed.w * 10.0) + aSeed.x * 40.0);
    // Face the direction of travel.
    vec3 fwd = normalize(dir + side * cos(travel * 1.3 + aSeed.y * 3.0) * 0.3);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    float size = 0.009 + aSeed.z * 0.003;
    vec3 world = p + (right * local.x + vec3(0.0, 1.0, 0.0) * local.y + fwd * local.z) * size;

    vAlpha = uShow * smoothstep(0.0, 0.03, life) * (1.0 - smoothstep(0.85, 1.0, life));
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  #include <fog_pars_fragment>
  void main() {
    if (vAlpha < 0.01) discard;
    gl_FragColor = vec4(uColor, vAlpha);
    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

/** A bat silhouette: body plus two wings; y on the wing tips drives the flap. */
function batGeometry(count: number): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  // x: span, y: flap amount, z: along body
  const p = [
    0, 0, 0.5, 0, 0, -0.6, -1, 0.9, 0.1, // left wing
    0, 0, 0.5, 0, 0, -0.6, 1, 0.9, 0.1, // right wing
    0, 0, 0.1, -0.55, 0.35, -0.45, -1, 0.9, 0.1,
    0, 0, 0.1, 0.55, 0.35, -0.45, 1, 0.9, 0.1,
  ];
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
  g.instanceCount = count;
  return g;
}

export default function Bats({ height, count }: { height: HeightField; count: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const { geometry, material } = useMemo(() => {
    const geometry = batGeometry(count);
    const material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: sky.uTime,
        uShow: { value: 0 },
        uOrigin: { value: new THREE.Vector3(BX, groundY(height, BX, BZ) + 0.004, BZ) },
        uColor: { value: new THREE.Color("#17131d") },
      },
    });
    return { geometry, material };
  }, [count, height]);

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    const u = (m.material as THREE.ShaderMaterial).uniforms;
    // Out at dusk, and only worth drawing when the camera is near downtown.
    const dusk = THREE.MathUtils.smoothstep(runtime.tod, 0.84, 0.88);
    const near = 1 - THREE.MathUtils.smoothstep(Math.hypot(runtime.cam.x - BX, runtime.cam.z - BZ) + runtime.cam.dist * 0.3, 10, 30);
    const want = runtime.reducedMotion ? 0 : dusk * near;
    u.uShow.value += (want - u.uShow.value) * (1 - Math.exp(-2 * Math.min(dt, 0.1)));
    m.visible = u.uShow.value > 0.01;
    // Catching the last light at dusk, then lit from below by the city.
    const n = sky.uNight.value;
    u.uColor.value.setRGB(0.3 - n * 0.1, 0.24 - n * 0.08, 0.26 - n * 0.06);
  });

  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} renderOrder={30} />;
}
