"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { AtlasTextures } from "./textures";
import { sky } from "@/lib/atlas/timeOfDay";
import {
  BASE_ELEV_M,
  CENTER_X,
  CENTER_Z,
  HEIGHT_KM,
  TERRAIN_EXAG,
  WIDTH_KM,
  X_MIN,
  Z_MIN,
} from "@/lib/atlas/geo";

const vertex = /* glsl */ `
  uniform sampler2D uHeight;
  uniform vec4 uRegion;
  uniform float uExag;
  uniform float uBase;
  varying vec2 vUv;
  varying vec3 vWorld;
  #include <fog_pars_vertex>

  void main() {
    vec3 p = position;
    vec2 uv = (p.xz - uRegion.xy) / uRegion.zw;
    float h = texture2D(uHeight, uv).r;
    p.y = (h - uBase) / 1000.0 * uExag;
    vUv = uv;
    vWorld = p;
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D uHeight;
  uniform sampler2D uNormal;
  uniform sampler2D uSurface;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uAmbient;
  uniform float uNight;
  uniform float uSurfPxM;
  uniform float uSdfLevels;
  varying vec2 vUv;
  varying vec3 vWorld;
  #include <fog_pars_fragment>

  vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float band(float v, float width) {
    // 1 on integer values of v, anti-aliased to ~width pixels
    float fw = fwidth(v);
    float d = 0.5 - abs(fract(v) - 0.5);
    return 1.0 - smoothstep(0.35 * fw * width, 1.25 * fw * width, d);
  }

  void main() {
    vec2 hd = texture2D(uHeight, vUv).rg;
    float h = hd.r;
    float dens = hd.g;
    vec3 n = normalize(texture2D(uNormal, vUv).xyz * 2.0 - 1.0);
    vec4 s = texture2D(uSurface, vUv);

    // Land: prairie cream in the east, limestone and cedar in the hills.
    float tH = smoothstep(120.0, 370.0, h);
    vec3 land = mix(lin(vec3(0.929, 0.898, 0.824)), lin(vec3(0.855, 0.820, 0.706)), tH);
    float slope = 1.0 - n.y;
    land = mix(land, lin(vec3(0.73, 0.74, 0.60)), smoothstep(0.03, 0.16, slope) * (0.25 + 0.45 * tH));
    land = mix(land, lin(vec3(0.77, 0.81, 0.63)), s.g * 0.6);
    land = mix(land, lin(vec3(0.86, 0.845, 0.815)), smoothstep(0.05, 0.6, dens) * 0.55);

    float diff = max(dot(n, uSunDir), 0.0);
    float skyl = 0.6 + 0.4 * n.y;
    vec3 col = land * (uAmbient * skyl * 0.72 + uSunColor * diff * 0.5);

    // Contours every 20 m, index contours every 100 m; fade out before they moiré.
    float c20 = band(h / 20.0, 1.0) * (1.0 - smoothstep(0.1, 0.35, fwidth(h / 20.0)));
    float c100 = band(h / 100.0, 1.6) * (1.0 - smoothstep(0.06, 0.25, fwidth(h / 100.0)));
    float contour = (c20 * 0.28 + c100 * 0.42) * (1.0 - 0.75 * uNight);
    col = mix(col, col * mix(lin(vec3(0.58, 0.45, 0.30)), lin(vec3(0.5, 0.62, 0.85)), uNight), contour);

    // Water from the signed distance field (metres; + on water).
    float sdfM = (s.r * 255.0 - 128.0) / uSdfLevels * uSurfPxM;
    float aa = max(fwidth(sdfM), 0.5);
    float water = smoothstep(-aa, aa, sdfM);
    vec3 wcol = mix(lin(vec3(0.60, 0.77, 0.80)), lin(vec3(0.39, 0.62, 0.70)), smoothstep(10.0, 260.0, sdfM));
    // Engraved waterlines following the shore, like an old survey map.
    float wl = 0.0;
    for (int k = 1; k <= 3; k++) {
      float r = float(k) * 34.0;
      wl += (1.0 - smoothstep(0.45 * aa, 1.3 * aa, abs(sdfM - r))) * (1.05 - float(k) * 0.28);
    }
    wl *= 1.0 - smoothstep(8.0, 30.0, aa);
    wcol *= 1.0 - wl * 0.16;
    wcol *= uAmbient * 0.75 + uSunColor * 0.35;
    wcol = mix(wcol, lin(vec3(0.035, 0.075, 0.12)), uNight * 0.92);
    col = mix(col, wcol, water);
    float shore = 1.0 - smoothstep(0.0, 1.4 * aa, abs(sdfM));
    col = mix(col, col * 0.72, shore * 0.45 * (1.0 - uNight));

    // Night: the land drops away and the built-up areas light up.
    col *= 1.0 - uNight * 0.8;
    vec2 cell = vWorld.xz * 90.0;
    vec2 fc = fwidth(cell);
    float speck = step(0.8, hash(floor(cell)));
    float lights = mix(speck, 0.2, smoothstep(0.25, 1.0, max(fc.x, fc.y)));
    float glow = smoothstep(0.02, 0.7, dens) * (0.18 + 1.1 * lights) * (1.0 - water);
    col += lin(vec3(1.0, 0.70, 0.38)) * glow * uNight * 0.85;

    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
    #ifdef USE_FOG
      // Fade the region's edges into the haze so the map has no hard border.
      float edge = smoothstep(0.0, 0.06, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
      gl_FragColor.rgb = mix(fogColor, gl_FragColor.rgb, edge);
    #endif
    #include <colorspace_fragment>
  }
`;

export default function Terrain({ tex, segments }: { tex: AtlasTextures; segments: number }) {
  const geometry = useMemo(() => {
    const segZ = Math.round((segments * HEIGHT_KM) / WIDTH_KM);
    const g = new THREE.PlaneGeometry(WIDTH_KM, HEIGHT_KM, segments, segZ);
    g.rotateX(-Math.PI / 2);
    g.translate(CENTER_X, 0, CENTER_Z);
    // The shader displaces vertices; give culling a box that contains the hills.
    g.boundingBox = new THREE.Box3(
      new THREE.Vector3(X_MIN, -0.1, Z_MIN),
      new THREE.Vector3(X_MIN + WIDTH_KM, 1.3, Z_MIN + HEIGHT_KM),
    );
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    return g;
  }, [segments]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        fog: true,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 2,
        uniforms: {
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          uHeight: { value: tex.height },
          uNormal: { value: tex.normal },
          uSurface: { value: tex.surface },
          uRegion: { value: new THREE.Vector4(X_MIN, Z_MIN, WIDTH_KM, HEIGHT_KM) },
          uExag: { value: TERRAIN_EXAG },
          uBase: { value: BASE_ELEV_M },
          uSurfPxM: { value: (WIDTH_KM * 1000) / tex.surface.image.width },
          uSdfLevels: { value: 4 },
          uSunColor: sky.uSunColor,
          uSunDir: sky.uSunDir,
          uAmbient: sky.uAmbient,
          uNight: sky.uNight,
        },
      }),
    [tex],
  );

  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}
