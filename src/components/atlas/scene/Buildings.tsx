"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BUILDING_EXAG } from "@/lib/atlas/geo";
import { runtime } from "@/lib/atlas/store";
import { sky } from "@/lib/atlas/timeOfDay";
import { siteUniforms } from "./siteState";

const vertex = /* glsl */ `
  attribute vec4 aInfo;
  attribute float aU;
  varying vec3 vWorld;
  varying vec4 vInfo;
  varying float vU;
  #include <fog_pars_vertex>
  void main() {
    vWorld = position;
    vInfo = aInfo;
    vU = aU;
    vec4 mvPosition = viewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

// A paper city from afar; up close, each building takes a material by its type (houses in
// painted siding under shingle or metal roofs, mid-rises in stone, stucco and brick with punched
// windows, towers in curtain-wall glass with mullions and the sky in them), plus rooftop plant.
const fragment = /* glsl */ `
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uAmbient;
  uniform vec3 uCamPos;
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform float uNight;
  uniform float uTime;
  uniform float uDetail;
  uniform vec4 uSite[64]; // rgb = colour (linear), a = emphasis 0..1 (<0: filtered out)
  uniform float uBuildingExag;
  varying vec3 vWorld;
  varying vec4 vInfo;
  varying float vU;
  #include <fog_pars_fragment>

  vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.7, 289.3))) * 15731.743); }
  vec3 pick(float r, vec3 a, vec3 b, vec3 c, vec3 d) { return r < 0.25 ? a : r < 0.5 ? b : r < 0.75 ? c : d; }

  void main() {
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    if (dot(n, uCamPos - vWorld) < 0.0) n = -n;
    float kind = vInfo.x;
    bool isSite = kind > -0.5;
    vec4 site = isSite ? uSite[int(kind + 0.5)] : vec4(0.0);
    if (site.a < -0.5) isSite = false; // filtered out: draw as a plain building
    float emph = isSite ? max(site.a, 0.0) : 0.0;
    float hM = vInfo.z;
    float r = vInfo.w;
    bool plant = kind < -1.5 && kind > -2.5;
    bool pitched = kind < -2.5;
    bool glass = hM >= 45.0 && !plant;

    float roof = smoothstep(0.7, 0.9, n.y);
    float wall = 1.0 - smoothstep(0.3, 0.5, abs(n.y));
    vec3 paper = lin(vec3(0.972, 0.955, 0.918)) * mix(0.9, 1.0, roof);

    // Materials by type.
    vec3 walls;
    if (glass) walls = pick(r, lin(vec3(0.55, 0.64, 0.72)), lin(vec3(0.47, 0.6, 0.62)), lin(vec3(0.72, 0.74, 0.76)), lin(vec3(0.62, 0.57, 0.52)));
    else if (hM >= 10.0) walls = pick(r, lin(vec3(0.93, 0.89, 0.8)), lin(vec3(0.86, 0.79, 0.66)), lin(vec3(0.83, 0.83, 0.81)), lin(vec3(0.76, 0.58, 0.48)));
    else walls = pick(r, lin(vec3(0.96, 0.95, 0.92)), lin(vec3(0.9, 0.85, 0.75)), lin(vec3(0.8, 0.84, 0.86)), lin(vec3(0.94, 0.88, 0.72)));
    vec3 mat;
    if (pitched) {
      vec3 shingle = pick(fract(r * 7.13), lin(vec3(0.34, 0.35, 0.37)), lin(vec3(0.46, 0.37, 0.31)), lin(vec3(0.66, 0.39, 0.29)), lin(vec3(0.68, 0.7, 0.72)));
      mat = n.y > 0.3 ? shingle : walls;
    } else if (plant) {
      mat = lin(vec3(0.36, 0.37, 0.39));
    } else {
      mat = mix(walls, lin(vec3(0.8, 0.79, 0.76)), roof);
    }

    // Facade detail by day, faded out before it can shimmer.
    float u = vU / 3.4;
    float fl = (vWorld.y - vInfo.y) * 1000.0 / uBuildingExag / 3.9;
    float fw = max(fwidth(u), fwidth(fl));
    float detail = uDetail * wall * (1.0 - smoothstep(0.3, 0.7, fw));
    if (!pitched && !plant && hM >= 10.0) {
      if (glass) {
        float m = fract(vU / 1.6);
        float mull = 1.0 - smoothstep(0.0, 0.07, min(m, 1.0 - m));
        float s = fract(fl);
        float slab = 1.0 - smoothstep(0.0, 0.09, min(s, 1.0 - s));
        vec3 view = normalize(uCamPos - vWorld);
        float fres = pow(1.0 - max(dot(view, n), 0.0), 3.0);
        mat = mix(mat, mix(uHorizon, uZenith, 0.55), (0.25 + 0.45 * fres) * detail);
        mat *= 1.0 - 0.3 * max(mull * 0.7, slab) * detail;
      } else {
        vec2 f = vec2(fract(u), fract(fl));
        float win = step(0.24, f.x) * step(f.x, 0.76) * step(0.3, f.y) * step(f.y, 0.82);
        mat = mix(mat, mat * vec3(0.5, 0.56, 0.64), win * detail * 0.7);
      }
    }

    vec3 base = mix(paper, mat, uDetail);
    if (isSite) base = mix(base, site.rgb, 0.55 + 0.4 * emph);

    float rel = clamp((vWorld.y - vInfo.y) / max(1e-4, hM * 0.001 * uBuildingExag), 0.0, 1.0);
    float ao = mix(0.72, 1.0, smoothstep(0.0, 0.4, rel));
    float diff = max(dot(n, uSunDir), 0.0);
    vec3 col = base * (uAmbient * (0.6 + 0.4 * n.y) * ao + uSunColor * diff * 0.55);

    col *= 1.0 - uNight * 0.84;
    // Lit windows after dark.
    if (wall > 0.5 && !plant && !pitched) {
      // Fewer windows lit at dusk than at full night, and fewer in houses than in towers.
      float dark = smoothstep(0.35, 1.0, uNight);
      float share = hM > 10.0 ? 0.86 - 0.18 * dark : 0.9 - 0.12 * dark;
      float lit = step(0.3, fract(u)) * step(0.35, fract(fl)) * step(share, hash(floor(vec2(u, fl)) + r * 97.0));
      float far = smoothstep(0.35, 1.1, fwidth(u));
      col += lin(vec3(1.0, 0.8, 0.5)) * mix(lit, 0.12, far) * dark * 0.9;
    }
    if (isSite) {
      float pulse = 0.5 + 0.5 * sin(uTime * 3.0);
      col += site.rgb * (uNight * (0.3 + 0.7 * emph) + emph * pulse * 0.18);
    }
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

/** Shared across both building meshes: 0 = paper city (far), 1 = full detail (near). */
const detail = { value: 0 };

export default function Buildings({ geometry }: { geometry: THREE.BufferGeometry }) {
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
          uDetail: detail,
          uSite: siteUniforms.uSite,
          uBuildingExag: { value: BUILDING_EXAG },
        },
      }),
    [],
  );
  useFrame(() => {
    detail.value = THREE.MathUtils.clamp((14 - runtime.cam.dist) / 8, 0, 1);
  });
  return <mesh geometry={geometry} material={material} />;
}
