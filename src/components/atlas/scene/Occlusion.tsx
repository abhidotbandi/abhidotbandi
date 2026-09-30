"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { groundY, type HeightField } from "@/lib/atlas/geo";
import { runtime } from "@/lib/atlas/store";

// Contact shadows, as in a toy model: the soft darkening where buildings meet the ground, down
// narrow streets and under trees. The buildings, trees, landmarks and site models around what
// the camera looks at are drawn from straight above into a height map (again only when the view
// has moved well across it, or zoomed a step); the ground, street and building shaders look
// round each point at the heights nearby and darken the sky's light by how much of the sky they
// hide. Desktop only, and faded out in wide views, where it would be under a pixel.

/** Objects drawn into the height map are on this layer as well as the default one. */
export const AO_LAYER = 2;

/** Put a mesh in the height map. */
export function aoCaster(o: THREE.Object3D) {
  o.layers.enable(AO_LAYER);
}

const blank = new THREE.DataTexture(new Uint16Array([0]), 1, 1, THREE.RedFormat, THREE.HalfFloatType);
blank.needsUpdate = true;

/** Shared by every material that takes contact shadows. */
export const occlusion = {
  uAoMap: { value: blank as THREE.Texture },
  /** the map's north-west corner x, z (km), its size (km), and the effect's strength (0 = off) */
  uAoBox: { value: new THREE.Vector4(0, 0, 1, 0) },
  /** heights are stored above this (world y), for half-float precision */
  uAoBase: { value: 0 },
};

const RES = 1024;

export const OCCLUSION_PARS = /* glsl */ `
  uniform sampler2D uAoMap;
  uniform vec4 uAoBox;
  uniform float uAoBase;
  // The height map, averaged over a patch as wide as the distance looked (a coarser mip level
  // further out), so the darkening falls off smoothly.
  float aoTop(vec2 xz, float lod) {
    vec2 uv = vec2((xz.x - uAoBox.x) / uAoBox.z, 1.0 - (xz.y - uAoBox.y) / uAoBox.z);
    return textureLod(uAoMap, uv, max(lod, 0.0)).r + uAoBase;
  }
  // How far up (as the sine of the angle) things 5 and 14 m away in direction d rise above y.
  float aoRise(vec2 xz, float y, vec2 d, float lod0) {
    float h1 = aoTop(xz + d * 0.005, lod0 - 7.64) - y;
    float h2 = aoTop(xz + d * 0.014, lod0 - 6.16) - y;
    float s1 = h1 > 0.0 ? h1 * inversesqrt(h1 * h1 + 0.000025) : 0.0;
    float s2 = h2 > 0.0 ? h2 * inversesqrt(h2 * h2 + 0.000196) : 0.0;
    return max(s1, s2);
  }
  // Open sky over a point, 0..1. Flat surfaces look all round; walls look out in front.
  float skyOpen(vec3 p, vec3 n) {
    if (uAoBox.w <= 0.0) return 1.0;
    vec2 uv = (p.xz - uAoBox.xy) / uAoBox.z;
    float edge = smoothstep(0.0, 0.08, min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y)));
    if (edge <= 0.0) return 1.0;
    // log2 of a sample patch 0.8 of the distance across, in texels, less log2 of the distance.
    float lod0 = log2(0.8 * ${RES.toFixed(1)} / uAoBox.z);
    float occ = 0.0;
    if (abs(n.y) < 0.5) {
      // Walls look from a couple of texels out, so the map's blur doesn't show them their own
      // building; and never go fully dark.
      vec2 f = normalize(n.xz);
      vec2 s = vec2(-f.y, f.x);
      vec3 q = p + vec3(f.x, 0.0, f.y) * (0.0008 + 2.0 * uAoBox.z / ${RES.toFixed(1)});
      occ = (aoRise(q.xz, q.y, f, lod0) + aoRise(q.xz, q.y, normalize(f + s * 0.6), lod0) +
        aoRise(q.xz, q.y, normalize(f - s * 0.6), lod0) + aoRise(q.xz, q.y, normalize(f + s * 1.7), lod0) +
        aoRise(q.xz, q.y, normalize(f - s * 1.7), lod0)) / 5.0;
      occ = min(occ, 0.4);
    } else {
      // A little above the surface, so it doesn't see itself.
      vec3 q = p + vec3(0.0, 0.0008, 0.0);
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.7853982;
        occ += aoRise(q.xz, q.y, vec2(cos(a), sin(a)), lod0);
      }
      occ /= 8.0;
    }
    // (Averaged heights understate a wall's: made up for here.)
    return 1.0 - min(1.0, occ * 1.8) * edge * uAoBox.w;
  }
`;

/** Writes each surface's height (world y, above uAoBase). */
const heightMaterial = new THREE.ShaderMaterial({
  vertexShader: /* glsl */ `
    uniform float uAoBase;
    varying float vH;
    void main() {
      vec4 w = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        w = instanceMatrix * w;
      #endif
      w = modelMatrix * w;
      vH = w.y - uAoBase;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `,
  fragmentShader: /* glsl */ `
    varying float vH;
    void main() { gl_FragColor = vec4(vH, 0.0, 0.0, 1.0); }
  `,
  uniforms: { uAoBase: occlusion.uAoBase },
  side: THREE.DoubleSide,
});

const clearColor = new THREE.Color();

export default function Occlusion({ ground, lowPower }: { ground: HeightField; lowPower: boolean }) {
  const holder = useMemo(() => {
    const rt = new THREE.WebGLRenderTarget(RES, RES, {
      type: THREE.HalfFloatType,
      format: THREE.RedFormat,
      depthBuffer: true,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 8);
    cam.up.set(0, 0, -1); // north up the map
    cam.layers.set(AO_LAYER);
    const o = new THREE.Object3D();
    o.userData = { rt, cam, x: Number.NaN, z: Number.NaN, r: 0, frames: 0 };
    return o;
  }, []);
  const ref = useRef<THREE.Object3D>(null);
  useEffect(
    () => () => {
      (holder.userData.rt as THREE.WebGLRenderTarget).dispose();
      occlusion.uAoBox.value.w = 0;
      occlusion.uAoMap.value = blank;
    },
    [holder],
  );

  useFrame((state) => {
    const o = ref.current;
    if (!o) return;
    const u = o.userData as { rt: THREE.WebGLRenderTarget; cam: THREE.OrthographicCamera; x: number; z: number; r: number; frames: number };
    const cam = runtime.cam;
    // Off on phones, and if the frame rate governor has dropped it (AtlasCanvas).
    const strength = lowPower || runtime.quality >= 2 ? 0 : 1 - THREE.MathUtils.smoothstep(cam.dist, 5, 9);
    if (strength <= 0) {
      occlusion.uAoBox.value.w = 0;
      return;
    }
    // Half the map's width, in steps of a quarter, so zooming redraws it now and then; its
    // centre a little toward the camera from what it looks at, on whole texels.
    const want = THREE.MathUtils.clamp(cam.dist * 0.75, 0.25, 3.5);
    const r = 0.25 * Math.pow(1.25, Math.ceil(Math.log(want / 0.25) / Math.log(1.25)));
    const texel = (2 * r) / RES;
    const b = THREE.MathUtils.degToRad(cam.bearing);
    const x = Math.round((cam.x - Math.sin(b) * r * 0.3) / texel) * texel;
    const z = Math.round((cam.z + Math.cos(b) * r * 0.3) / texel) * texel;
    // Redraw when the view has moved a good way across the map, or zoomed a step, and now and
    // then while still (tiles and trees stream in).
    const moved = Math.hypot(x - u.x, z - u.z) > r * 0.12 || r !== u.r || Number.isNaN(u.x);
    if (moved || ++u.frames > 45) {
      const gy = groundY(ground, cam.x, cam.z);
      occlusion.uAoBase.value = gy - 0.3;
      u.cam.left = -r;
      u.cam.right = r;
      u.cam.top = r;
      u.cam.bottom = -r;
      u.cam.position.set(x, gy + 4, z);
      u.cam.lookAt(x, gy, z);
      u.cam.updateProjectionMatrix();
      u.cam.updateMatrixWorld();

      const gl = state.gl;
      const scene = state.scene;
      const prev = gl.getRenderTarget();
      const shadows = gl.shadowMap.needsUpdate;
      gl.getClearColor(clearColor);
      const alpha = gl.getClearAlpha();
      gl.shadowMap.needsUpdate = false;
      scene.overrideMaterial = heightMaterial;
      gl.setRenderTarget(u.rt);
      gl.setClearColor(0x000000, 0);
      gl.clear();
      gl.render(scene, u.cam);
      scene.overrideMaterial = null;
      gl.setRenderTarget(prev);
      gl.setClearColor(clearColor, alpha);
      gl.shadowMap.needsUpdate = shadows;

      occlusion.uAoMap.value = u.rt.texture;
      occlusion.uAoBox.value.set(x - r, z - r, 2 * r, strength);
      Object.assign(u, { x, z, r, frames: 0 });
    }
    occlusion.uAoBox.value.w = strength;
  });
  return <primitive ref={ref} object={holder} />;
}
