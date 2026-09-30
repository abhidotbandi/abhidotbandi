"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { groundY, type HeightField } from "@/lib/atlas/geo";
import { runtime, useAtlas } from "@/lib/atlas/store";
import { sky } from "@/lib/atlas/timeOfDay";
import { CLOUD_SLOTS, cloudShadows } from "./shadows";

// Fair-weather cumulus drifting over the map on the south-easterly breeze: puffy, faceted, lit
// like the rest of the model (bright tops, cool grey-blue bellies, the sun's colour at dawn and
// dusk, dark at night with the city's glow underneath), each casting a soft shadow on the ground
// and buildings below. The field wraps around what the camera looks at, so there are always
// clouds about (they shrink away before they wrap, and thin out in the widest views). They keep
// to the edges of the picture: any drifting over the middle, around what the camera looks at, or
// too close to the camera, shrink away. A few are placed to frame the opening view; they're in
// the poster too, and start drifting when the live map appears.

/** The field repeats every `tile` km around the view: about six clouds per 100 km². */
const FIELD = { tile: 56, count: 190, detail: 1 };
const FIELD_LO = { tile: 40, count: 96, detail: 1 };
const VARIANTS = 5;
const WIND = new THREE.Vector2(-0.0052, -0.0068); // km/s: a south-easterly breeze, ~8.5 m/s
/** Clouds whose shadows fall within this of what the camera looks at cast them, km. */
const SHADE_R = 8;
/** Clouds framing the opening view (tour.ts): x, z of their middle, km, and size, km. */
const OPENING = [
  [-2.107, -1.394, 0.62],
  [0.8, -1.52, 0.55],
  [-1.269, -2.243, 0.42],
];
/** The clear middle of the picture: clouds keep this far (their edge, in half-heights) from its focus. */
const CLEAR_IN = 0.4;
const CLEAR_OUT = 0.7;

const vertex = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vBelly;
  #include <fog_pars_vertex>
  void main() {
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    // Normals through the instance's squash: by the inverse of each axis's scale.
    mat3 im = mat3(instanceMatrix);
    vec3 s2 = max(vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2])), vec3(1e-10));
    vNormal = normalize(mat3(modelMatrix) * (im * (normal / s2)));
    vBelly = position.y; // -1 at the flat base .. 1 at the top of the tallest puff
    vec4 mvPosition = viewMatrix * w;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uAmbient;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform float uNight;
  uniform vec3 uCamPos;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vBelly;
  #include <fog_pars_fragment>
  vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
  void main() {
    vec3 n = normalize(vNormal);
    float top = smoothstep(-0.6, 0.9, vBelly);
    vec3 belly = mix(lin(vec3(0.84, 0.86, 0.9)), uZenith * 0.9 + 0.15, 0.2);
    vec3 base = mix(belly, lin(vec3(1.0, 0.995, 0.98)), top);
    // Soft, wrapped light (clouds are bright even in their own shade), and a bright rim where the
    // sun shines through the edges.
    float sun = clamp((dot(n, uSunDir) + 0.5) / 1.5, 0.0, 1.0);
    float rim = pow(1.0 - abs(dot(normalize(uCamPos - vWorld), n)), 3.0);
    vec3 col = base * (uAmbient * (0.8 + 0.2 * n.y) * 1.1 + uSunColor * sun * 0.45);
    col += uSunColor * rim * 0.08 * (1.0 - uNight);
    // Dawn and dusk tint the sides facing the sun.
    col += uSunColor * pow(sun, 3.0) * 0.12;
    // Night: dark, with the city's orange glow on their bellies.
    float dark = smoothstep(0.3, 1.0, uNight);
    col = mix(col, lin(vec3(0.1, 0.11, 0.16)) + lin(vec3(0.36, 0.22, 0.12)) * (1.0 - top) * 0.35, dark * 0.92);
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

/** A cloud: a flat-based cushion of rounded puffs, about 1 unit long and 0.75 wide. */
function cloudGeometry(seed: number, detail: number): THREE.BufferGeometry {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const parts: THREE.BufferGeometry[] = [];
  const puff = (r: number, x: number, y: number, z: number) => {
    const g = new THREE.IcosahedronGeometry(r, detail);
    // Smooth normals, straight out from the puff's centre, whatever its detail; then shared
    // corners merged, so a puff is 12 or 42 vertices rather than 60 or 240.
    g.setAttribute("normal", g.attributes.position.clone());
    g.normalizeNormals();
    g.deleteAttribute("uv");
    g.translate(x, y, z);
    parts.push(mergeVertices(g, 1e-6));
  };
  // A ring of low puffs round the edge...
  const n = 5 + Math.floor(rnd() * 3);
  const turn = rnd() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = turn + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    const r = 0.15 + rnd() * 0.07;
    puff(r, Math.cos(a) * (0.33 - r * 0.4), r * 0.25, Math.sin(a) * (0.2 - r * 0.3));
  }
  // ...heaped up in the middle.
  const m = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < m; i++) {
    const r = 0.2 + rnd() * 0.07;
    puff(r, (rnd() - 0.5) * 0.3, r * (0.55 + rnd() * 0.25), (rnd() - 0.5) * 0.12);
  }
  let count = 0;
  let indices = 0;
  for (const p of parts) {
    count += p.attributes.position.count;
    indices += p.index!.count;
  }
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const index = new Uint16Array(indices);
  let o = 0;
  let io = 0;
  let top = 0;
  for (const p of parts) {
    const first = o / 3;
    const pi = p.index!.array;
    for (let i = 0; i < pi.length; i++) index[io++] = pi[i] + first;
    const a = p.attributes.position.array as Float32Array;
    const na = p.attributes.normal.array as Float32Array;
    for (let i = 0; i < a.length; i += 3, o += 3) {
      // Flatten the bottom: cumulus sit on a level base. (Normals scale by the inverse.)
      const k = a[i + 1] > 0 ? 0.85 : 0.15;
      pos[o] = a[i];
      pos[o + 1] = a[i + 1] * k;
      pos[o + 2] = a[i + 2];
      nrm[o] = na[i];
      nrm[o + 1] = na[i + 1] / k;
      nrm[o + 2] = na[i + 2];
      top = Math.max(top, pos[o + 1]);
    }
  }
  // y from -1 (base) to 1 (top), for the shader's belly shading; the matrix rescales it.
  for (let i = 1; i < pos.length; i += 3) {
    pos[i] = (pos[i] / top) * 2 - 1;
    nrm[i] *= top / 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

interface Cloud {
  x: number;
  z: number;
  alt: number; // base, world km (the terrain is exaggerated: the hills top out near 0.8)
  base: number; // this frame's: kept clear of the hills below
  size: number; // km across
  height: number; // km tall
  spin: number;
  variant: number;
  slot: number;
  shown: number; // 0..1, eased
  /** where it is this frame, and how grown in */
  px: number;
  pz: number;
  sc: number;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const p3 = new THREE.Vector3();
const s3 = new THREE.Vector3();
const eye = new THREE.Vector3();
const ap = new THREE.Vector3();
const fwd = new THREE.Vector3();
const ndc = new THREE.Vector3();
const focus = new THREE.Vector3();
const nearD = new Float32Array(CLOUD_SLOTS);
const nearC: (Cloud | null)[] = new Array(CLOUD_SLOTS).fill(null);
const { smoothstep } = THREE.MathUtils;

export default function Clouds({ ground, lowPower }: { ground: HeightField; lowPower: boolean }) {
  const ready = useAtlas((s) => s.ready);
  const root = useMemo(() => {
    const { tile, count, detail } = lowPower ? FIELD_LO : FIELD;
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      fog: true,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uSunColor: sky.uSunColor,
        uSunDir: sky.uSunDir,
        uAmbient: sky.uAmbient,
        uZenith: sky.uZenith,
        uHorizon: sky.uHorizon,
        uNight: sky.uNight,
        uCamPos: { value: new THREE.Vector3() },
      },
    });
    const counts = new Array(VARIANTS).fill(0);
    const clouds: Cloud[] = [];
    for (let i = 0; i < count; i++) {
      const variant = i % VARIANTS;
      const opening = OPENING[i];
      const size = opening ? opening[2] : 0.35 + rnd() * rnd() * 0.95;
      const height = size * (opening ? 0.32 : 0.26 + rnd() * 0.12);
      clouds.push({
        x: opening ? opening[0] : rnd() * tile,
        z: opening ? opening[1] : rnd() * tile,
        alt: opening ? 0.95 - height / 2 : 0.6 + rnd() * 0.55,
        size,
        height,
        spin: rnd() * Math.PI * 2,
        variant,
        slot: counts[variant]++,
        shown: 0,
        base: 0,
        px: 0,
        pz: 0,
        sc: 0,
      });
    }
    const meshes = counts.map((c, v) => {
      const m = new THREE.InstancedMesh(cloudGeometry(v + 1, detail), material, c);
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return m;
    });
    const g = new THREE.Group();
    g.add(...meshes);
    g.userData = { meshes, clouds, tile };
    return g;
  }, [lowPower]);

  const group = useRef<THREE.Group>(null);
  useFrame((state, rawDt) => {
    const g = group.current;
    if (!g) return;
    const { meshes, clouds, tile } = g.userData as { meshes: THREE.InstancedMesh[]; clouds: Cloud[]; tile: number };
    const dt = Math.min(rawDt, 0.1);
    const cam = runtime.cam;
    // Still, and fully in place, until the live map appears (and for the poster); drifting after.
    const still = !ready || !!runtime.poster;
    if (!still && g.userData.t0 === undefined) g.userData.t0 = sky.uTime.value;
    const t = still || runtime.reducedMotion ? 0 : sky.uTime.value - g.userData.t0;
    const ease = still ? 1 : 1 - Math.exp(-(runtime.reducedMotion ? 30 : 1.4) * dt);
    // Thinning out in the widest views, where the edge of the field would show.
    const want = 1 - smoothstep(cam.dist, 40, 62);
    const gy = groundY(ground, cam.x, cam.z);
    const camera = state.camera as THREE.PerspectiveCamera;
    eye.copy(camera.position);
    camera.getWorldDirection(fwd);
    focus.set(cam.x, gy, cam.z).project(camera);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    (meshes[0].material as THREE.ShaderMaterial).uniforms.uCamPos.value.copy(eye);
    let visible = false;
    for (const c of clouds) {
      // Drift, and wrap to the tile around the view.
      const wx = c.x + WIND.x * t;
      const wz = c.z + WIND.y * t;
      const dx = ((((wx - cam.x) % tile) + tile * 1.5) % tile) - tile / 2;
      const dz = ((((wz - cam.z) % tile) + tile * 1.5) % tile) - tile / 2;
      const x = cam.x + dx;
      const z = cam.z + dz;
      c.base = Math.max(c.alt, groundY(ground, x, z) + 0.35);
      p3.set(x, c.base + c.height * 0.5, z);
      ap.subVectors(p3, eye);
      const ed = ap.length();
      // Out of the middle of the picture, where what the camera looks at is.
      let clearOfView = 1;
      if (ap.dot(fwd) > 0) {
        ndc.copy(p3).project(camera);
        const off = Math.hypot((ndc.x - focus.x) * camera.aspect, ndc.y - focus.y) - (c.size * 0.5) / (ed * tanHalf);
        clearOfView = smoothstep(off, CLEAR_IN, CLEAR_OUT);
      }
      const open =
        clearOfView *
        smoothstep(ed, 0.6, 1.8) *
        (1 - smoothstep(Math.max(Math.abs(dx), Math.abs(dz)), tile * 0.38, tile * 0.5));
      c.shown += (want * open - c.shown) * ease;
      const sc = c.shown < 0.01 ? 0 : c.shown;
      if (sc > 0) visible = true;
      c.px = x;
      c.pz = z;
      c.sc = sc;
      q.setFromAxisAngle(up, c.spin);
      s3.set(c.size * sc, c.height * 0.5 * sc, c.size * sc);
      p3.y = c.base + c.height * 0.5 * sc;
      m4.compose(p3, q, s3);
      meshes[c.variant].setMatrixAt(c.slot, m4);
    }
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
    g.visible = visible;

    // Shadows: the clouds whose shadows fall nearest what the camera looks at, fading out with
    // distance from it, as the view pulls back, and as the sun gets low.
    const A = cloudShadows.uCloudA.value;
    const B = cloudShadows.uCloudB.value;
    A.fill(0);
    const sun = sky.uSunDir.value;
    const strength = 0.72 * (1 - smoothstep(cam.dist, 10, 20)) * smoothstep(sun.y, 0.05, 0.2);
    if (!visible || strength <= 0) return;
    nearD.fill(Infinity);
    nearC.fill(null);
    const kx = sun.x / sun.y;
    const kz = sun.z / sun.y;
    for (const c of clouds) {
      if (c.sc <= 0) continue;
      const lift = c.base + c.height * 0.35 - gy;
      const d = Math.hypot(c.px - kx * lift - cam.x, c.pz - kz * lift - cam.z) - c.size * 0.5;
      if (d >= SHADE_R || d >= nearD[CLOUD_SLOTS - 1]) continue;
      let i = CLOUD_SLOTS - 1;
      for (; i > 0 && nearD[i - 1] > d; i--) {
        nearD[i] = nearD[i - 1];
        nearC[i] = nearC[i - 1];
      }
      nearD[i] = d;
      nearC[i] = c;
    }
    for (let i = 0; i < CLOUD_SLOTS; i++) {
      const c = nearC[i];
      if (!c) break;
      A[i * 4] = c.px;
      A[i * 4 + 1] = c.pz;
      A[i * 4 + 2] = c.base + c.height * 0.35;
      A[i * 4 + 3] = c.size * 0.48 * c.sc;
      B[i * 4] = Math.cos(c.spin);
      B[i * 4 + 1] = -Math.sin(c.spin);
      B[i * 4 + 2] = 0.65;
      B[i * 4 + 3] = strength * c.sc * (1 - smoothstep(nearD[i], SHADE_R - 2.5, SHADE_R));
    }
  });

  return <primitive ref={group} object={root} />;
}
