"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Central } from "@/lib/atlas/central";
import { groundY, project, type HeightField } from "@/lib/atlas/geo";
import { nearestIndex } from "@/lib/atlas/paths";
import { runtime } from "@/lib/atlas/store";
import { sky } from "@/lib/atlas/timeOfDay";

// The Congress Avenue Bridge bats. At dusk the colony pours out from under the deck, skims
// east down Lady Bird Lake, then climbs away east-southeast toward the farmland where it
// feeds: one long ribbon that snakes like smoke, made of thousands of flapping bats.

// The bridge's middle, where the colony roosts in the joints under the deck.
const [BX, BZ] = project(-97.74516, 30.26175);
const PATH_POINTS = 48;

const vertex = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uShow;
  uniform vec4 uPath[${PATH_POINTS}]; // world km, spaced evenly along the stream
  uniform float uLength; // km
  uniform float uPxK; // km per CSS pixel, per km of depth
  varying float vAlpha;
  #include <fog_pars_vertex>

  vec3 pathAt(float d) {
    float f = clamp(d / uLength, 0.0, 1.0) * ${PATH_POINTS - 1}.0;
    int i = int(min(floor(f), ${PATH_POINTS - 2}.0));
    return mix(uPath[i].xyz, uPath[i + 1].xyz, f - float(i));
  }

  // A point in the stream, d km along it: the path, the ribbon's own slow meander (shared by
  // every bat at the same distance, and drifting downstream far slower than the bats fly, so
  // they stream through it), and this bat's place across the ribbon, which widens (spread) as
  // the bat peels off and fades.
  vec3 streamAt(float d, vec2 disk, float spread) {
    vec3 p = pathAt(d);
    vec3 dir = pathAt(d + 0.03) - p;
    vec3 side = normalize(vec3(-dir.z, 0.0, dir.x) + vec3(1e-6, 0.0, 0.0));
    // Out from under the deck the colony is spread along the bridge (north-south); within a
    // few hundred metres that turns into the ribbon's own cross-section.
    vec3 along = vec3(0.0, 0.0, side.z < 0.0 ? -1.0 : 1.0);
    side = normalize(mix(along, side, smoothstep(0.0, 0.3, d)));
    // Pulled into a tight ribbon that puffs out and pinches in along its length, then disperses.
    float r = mix(0.11, 0.012, smoothstep(0.0, 0.25, d)) + 0.02 * max(0.0, d - 0.25);
    r *= (1.0 + 0.35 * sin(d * 7.3 - uTime * 0.23 + 2.0)) * (1.0 + 2.5 * spread);
    float amp = 0.075 * smoothstep(0.2, 2.2, d);
    float lat = amp * (sin(d * 4.6 - uTime * 0.21) + 0.5 * sin(d * 10.7 - uTime * 0.47 + 1.3));
    float up = 0.4 * amp * sin(d * 3.7 - uTime * 0.17 + 0.7) + 0.002 * sin(d * 30.0 - uTime * 1.3);
    return p + side * (lat + disk.x * r) + vec3(0.0, up + disk.y * r * 0.3, 0.0);
  }

  void main() {
    float speed = 0.03 + aSeed.w * 0.012; // km/s
    // Each bat peels off somewhere downstream, so the ribbon is densest near the bridge and
    // thins out as it climbs away.
    float trip = mix(1.6, uLength, fract(aSeed.w * 7.31 + aSeed.y * 3.17));
    float life = fract(uTime * speed / trip + aSeed.x);
    float d = life * trip;
    // The colony leaves in waves: bunch bats up along the stream, the bunches travelling with
    // them (each wave moves at about their speed, and together they never reorder bats).
    float bunch = 0.035 * sin(d * 18.0 - uTime * 0.6) + 0.02 * sin(d * 7.1 - uTime * 0.24 + 1.7);
    d = max(0.0, d + bunch * smoothstep(0.0, 0.2, d));
    float a = aSeed.y * 6.2832;
    vec2 disk = sqrt(aSeed.z) * vec2(cos(a), sin(a));
    float fade = smoothstep(0.72, 1.0, life);

    vec3 c = streamAt(d, disk, fade);
    vec3 fwd = normalize(streamAt(d + 0.012, disk, fade) - c + vec3(0.0, 0.0, 1e-6));
    // Each bat's own flutter, a few metres either way.
    float ph = aSeed.x * 91.0 + aSeed.y * 17.0;
    c += vec3(sin(uTime * 1.9 + ph), 0.5 * sin(uTime * 2.7 + ph * 1.3), cos(uTime * 2.3 + ph)) * 0.0025;

    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)) + vec3(1e-6, 0.0, 0.0));
    vec3 bodyUp = cross(right, fwd);

    // Wingbeats (8-11 Hz): the wings swing up and down about the body.
    float flap = sin(uTime * (50.0 + 20.0 * aSeed.w) + ph * 3.0) * 0.85;
    vec3 local = position;
    float span = abs(local.x);
    local.y = span * sin(flap);
    local.x *= cos(flap);

    // A few pixels across at any zoom (larger near the camera), never smaller than life.
    float depth = max(0.001, -(viewMatrix * vec4(c, 1.0)).z);
    float px = mix(9.0, 4.5, smoothstep(0.3, 5.0, depth));
    float size = max(0.00028, px * depth * uPxK) * 0.5;
    vec3 world = c + (right * local.x + bodyUp * local.y + fwd * local.z) * size;

    vAlpha = uShow * smoothstep(0.0, 0.03, d) * (1.0 - fade);
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
    gl_FragColor = vec4(uColor, vAlpha * 0.92);
    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * A bat seen from above, wingspan 2 (x), nose toward +z: a body and two broad wings with
 * scalloped trailing edges, chunky enough to read at a few pixels. The shader swings |x| up
 * and down for the wingbeat.
 */
function batGeometry(count: number): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  const p: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => p.push(...a, ...b, ...c);
  // Body.
  tri([0, 0, 0.5], [-0.12, 0, 0], [0.12, 0, 0]);
  tri([-0.12, 0, 0], [0, 0, -0.5], [0.12, 0, 0]);
  for (const s of [-1, 1]) {
    const lead = [0.1 * s, 0, 0.26];
    const tip = [1 * s, 0, 0.12];
    const t1 = [0.72 * s, 0, -0.42];
    const t2 = [0.38 * s, 0, -0.3];
    const root = [0.1 * s, 0, -0.42];
    tri(lead, tip, t1);
    tri(lead, t1, t2);
    tri(lead, t2, root);
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
  g.instanceCount = count;
  return g;
}

/**
 * The stream's centreline, as evenly spaced points (world km): down the lake from the bridge
 * for its first 1.25 km, low over the water and climbing gently, then up and away
 * east-southeast over East Austin.
 */
function streamPath(c: Central, ground: HeightField): { points: THREE.Vector4[]; length: number } {
  const water = groundY(ground, BX, BZ);
  const ctrl: THREE.Vector3[] = [];
  // Height above the water, world km, by distance along the lake: under the deck to start.
  const lift = (d: number) => 0.002 + 0.004 * THREE.MathUtils.smoothstep(d, 0, 0.15) + 0.07 * THREE.MathUtils.smoothstep(d, 0.15, 1.25);
  ctrl.push(new THREE.Vector3(BX, water + lift(0), BZ));
  const river = c.rivers.ladybird;
  if (river) {
    // Downstream is up the centreline's indices; take a point every ~120 m.
    const line = river.line;
    let d = 0;
    let next = 0.12;
    let px = BX;
    let pz = BZ;
    for (let i = nearestIndex(line, BX, BZ) + 1; i < line.length / 2 && d < 1.25; i++) {
      const x = line[i * 2];
      const z = line[i * 2 + 1];
      d += Math.hypot(x - px, z - pz);
      px = x;
      pz = z;
      if (d >= next) {
        ctrl.push(new THREE.Vector3(x, water + lift(d), z));
        next += 0.12;
      }
    }
  }
  // Then up and away east-southeast, relative to the bridge.
  for (const [dx, dz, y] of [
    [1.35, 1.38, 0.13],
    [2.35, 1.62, 0.21],
    [3.55, 2.02, 0.32],
    [4.8, 2.48, 0.44],
    [6.0, 2.92, 0.54],
  ]) {
    ctrl.push(new THREE.Vector3(BX + dx, water + y, BZ + dz));
  }
  const curve = new THREE.CatmullRomCurve3(ctrl, false, "centripetal");
  const pts = curve.getSpacedPoints(PATH_POINTS - 1);
  let length = 0;
  const points = pts.map((p, i) => {
    if (i > 0) length += p.distanceTo(pts[i - 1]);
    return new THREE.Vector4(p.x, p.y, p.z, length);
  });
  return { points, length };
}

const DUSK = new THREE.Color("#141013");
const NIGHT = new THREE.Color("#3a3230");

export default function Bats({ central, ground, count }: { central: Central; ground: HeightField; count: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const { geometry, material } = useMemo(() => {
    const geometry = batGeometry(count);
    const path = streamPath(central, ground);
    const material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: { value: 0 },
        uShow: { value: 0 },
        uPath: { value: path.points },
        uLength: { value: path.length },
        uPxK: { value: 0.0006 },
        uColor: { value: DUSK.clone() },
      },
    });
    return { geometry, material };
  }, [central, ground, count]);

  useFrame((state, dt) => {
    const m = mesh.current;
    if (!m) return;
    const u = (m.material as THREE.ShaderMaterial).uniforms;
    // Out from golden hour (in summer they often leave before sunset) and on into the night,
    // and only worth drawing when the camera is near downtown.
    const dusk = THREE.MathUtils.smoothstep(runtime.tod, 0.805, 0.84);
    const near = 1 - THREE.MathUtils.smoothstep(Math.hypot(runtime.cam.x - BX, runtime.cam.z - BZ) + runtime.cam.dist * 0.3, 10, 30);
    const want = dusk * near;
    u.uShow.value += (want - u.uShow.value) * (runtime.reducedMotion ? 1 : 1 - Math.exp(-2 * Math.min(dt, 0.1)));
    m.visible = u.uShow.value > 0.01;
    if (!m.visible) return;
    // Reduced motion: the stream holds still, mid-flight.
    u.uTime.value = runtime.reducedMotion ? 60 : state.clock.elapsedTime;
    const cam = state.camera as THREE.PerspectiveCamera;
    u.uPxK.value = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / Math.max(1, state.size.height);
    // Dark silhouettes against the dusk; after dark, faintly lit from below by the city.
    (u.uColor.value as THREE.Color).copy(DUSK).lerp(NIGHT, sky.uNight.value);
  });

  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} renderOrder={30} />;
}
