"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { sky } from "@/lib/atlas/timeOfDay";

const vertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
    gl_Position = p.xyww; // pin to the far plane
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uNight;
  varying vec3 vDir;

  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

  void main() {
    vec3 d = normalize(vDir);
    float up = clamp(d.y, -1.0, 1.0);
    float t = pow(clamp(up, 0.0, 1.0), 0.45);
    vec3 col = mix(uHorizon, uZenith, t);
    // Below the horizon: the paper the map sheet sits on, softened by haze near the horizon.
    col = mix(col, mix(uHorizon, uGround, smoothstep(-0.02, -0.35, up)), smoothstep(0.01, -0.03, up));
    float sd = max(dot(d, uSunDir), 0.0);
    float day = 1.0 - uNight;
    col += uSunColor * (pow(sd, 700.0) * 3.0 + pow(sd, 18.0) * 0.28) * day;
    // Stars.
    vec3 g = floor(d * 380.0);
    float star = step(0.9965, hash(g)) * smoothstep(0.05, 0.4, up);
    col += vec3(star) * uNight * 0.9;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export default function Sky() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        uniforms: {
          uZenith: sky.uZenith,
          uHorizon: sky.uHorizon,
          uGround: sky.uGround,
          uSunColor: sky.uSunColor,
          uSunDir: sky.uSunDir,
          uNight: sky.uNight,
        },
      }),
    [],
  );
  const geometry = useMemo(() => new THREE.SphereGeometry(10, 48, 24), []);
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={-1000} />;
}
