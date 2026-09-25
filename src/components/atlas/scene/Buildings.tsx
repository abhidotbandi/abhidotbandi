"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { BUILDING_EXAG } from "@/lib/atlas/geo";
import { sky } from "@/lib/atlas/timeOfDay";
import { siteUniforms } from "./siteState";

const vertex = /* glsl */ `
  attribute vec3 aInfo;
  varying vec3 vWorld;
  varying vec3 vInfo;
  #include <fog_pars_vertex>
  void main() {
    vWorld = position;
    vInfo = aInfo;
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
  uniform float uNight;
  uniform float uTime;
  uniform vec4 uSite[64]; // rgb = colour (linear), a = emphasis 0..1 (<0: filtered out)
  uniform float uBuildingExag;
  varying vec3 vWorld;
  varying vec3 vInfo;
  #include <fog_pars_fragment>

  vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.7, 289.3))) * 15731.743); }

  void main() {
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    if (dot(n, uCamPos - vWorld) < 0.0) n = -n;
    bool isSite = vInfo.x > -0.5;
    vec4 site = isSite ? uSite[int(vInfo.x + 0.5)] : vec4(0.0);
    if (site.a < -0.5) isSite = false; // filtered out: draw as a plain building
    float emph = isSite ? max(site.a, 0.0) : 0.0;

    float roof = smoothstep(0.7, 0.9, n.y);
    vec3 base = lin(vec3(0.972, 0.955, 0.918)) * mix(0.9, 1.0, roof);
    if (isSite) base = mix(base, site.rgb, 0.55 + 0.4 * emph);

    float rel = clamp((vWorld.y - vInfo.y) / max(1e-4, vInfo.z * 0.001 * uBuildingExag), 0.0, 1.0);
    float ao = mix(0.72, 1.0, smoothstep(0.0, 0.4, rel));
    float diff = max(dot(n, uSunDir), 0.0);
    vec3 col = base * (uAmbient * (0.6 + 0.4 * n.y) * ao + uSunColor * diff * 0.55);

    col *= 1.0 - uNight * 0.84;
    // Lit windows after dark, on walls of anything taller than a house.
    if (abs(n.y) < 0.35 && vInfo.z > 8.0) {
      vec3 t = normalize(vec3(-n.z, 0.0, n.x));
      float u = dot(vWorld, t) * 1000.0 / 3.4;
      float v = (vWorld.y - vInfo.y) * 1000.0 / uBuildingExag / 3.9;
      float lit = step(0.3, fract(u)) * step(0.35, fract(v)) * step(0.58, hash(floor(vec2(u, v)) + vInfo.z));
      float far = smoothstep(0.35, 1.1, fwidth(u));
      col += lin(vec3(1.0, 0.8, 0.5)) * mix(lit, 0.2, far) * uNight * 0.95;
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
          uNight: sky.uNight,
          uTime: sky.uTime,
          uSite: siteUniforms.uSite,
          uBuildingExag: { value: BUILDING_EXAG },
        },
      }),
    [],
  );
  return <mesh geometry={geometry} material={material} />;
}
