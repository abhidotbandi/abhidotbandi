"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { AtlasTextures } from "./textures";
import { sky } from "@/lib/atlas/timeOfDay";
import {
  BASE_ELEV_M,
  CENTER_X,
  CENTER_Z,
  CX_MAX,
  CX_MIN,
  CZ_MAX,
  CZ_MIN,
  C_HEIGHT_KM,
  C_WIDTH_KM,
  HEIGHT_KM,
  TERRAIN_EXAG,
  WIDTH_KM,
  X_MIN,
  Z_MIN,
  elevToY,
  type PatchGrid,
} from "@/lib/atlas/geo";

// The base terrain displaces a regular grid from its height texture. The central patch's
// vertices already carry their heights (built on the CPU so everything placed on the ground
// matches), so its vertex shader only passes them through.
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
    #ifndef PATCH
      float h = texture2D(uHeight, uv).r;
      p.y = (h - uBase) / 1000.0 * uExag;
    #endif
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
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uCamPos;
  uniform float uNight;
  uniform float uTime;
  uniform float uZoomOut;
  uniform float uSurfPxM;
  uniform float uSdfLevels;
  uniform float uSdfK;
  uniform vec3 uGround;
  uniform vec4 uRegion;
  uniform vec4 uPatchRect;
  #ifdef PATCH
    uniform sampler2D uBaseHeight;
    uniform sampler2D uBaseNormal;
    uniform sampler2D uBaseSurface;
    uniform vec4 uBaseRegion;
    uniform float uBaseSurfPxM;
  #endif
  varying vec2 vUv;
  varying vec3 vWorld;
  #include <fog_pars_fragment>

  vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float band(float v, float width) {
    // 1 on integer values of v, anti-aliased to ~width pixels
    float fw = fwidth(v);
    float d = 0.5 - abs(fract(v) - 0.5);
    return 1.0 - smoothstep(0.35 * fw * width, 1.25 * fw * width, d);
  }

  // Slope of one travelling wave (p, lambda in metres), faded out before it aliases.
  vec2 wave(vec2 p, vec2 dir, float lambda, float steep, float t, float fp) {
    float k = 6.2832 / lambda;
    float ph = k * dot(dir, p) - sqrt(9.81 * k) * t * 0.5;
    float fade = 1.0 - smoothstep(lambda * 0.18, lambda * 0.45, fp);
    return dir * (steep * cos(ph) * fade);
  }

  // Wind ripples from the south-east (Austin's prevailing wind), plus irregular chop.
  vec2 waterSlope(vec2 p, float t, float fp) {
    vec2 g = vec2(0.0);
    g += wave(p, normalize(vec2(-0.62, -0.78)), 3.1, 0.10, t, fp);
    g += wave(p, normalize(vec2(-0.83, -0.40)), 5.3, 0.12, t, fp);
    g += wave(p, normalize(vec2(-0.30, -0.95)), 8.9, 0.10, t, fp);
    g += wave(p, normalize(vec2(-0.95, -0.15)), 15.0, 0.07, t, fp);
    g += wave(p, normalize(vec2(-0.55, -0.62)), 27.0, 0.05, t, fp);
    vec2 q = p * 0.19 + vec2(t * 0.21, -t * 0.17);
    vec2 chop = vec2(vnoise(q), vnoise(q + 17.3)) - 0.5;
    return g + chop * 0.22 * (1.0 - smoothstep(0.8, 2.5, fp));
  }

  void main() {
    #ifndef PATCH
      // The central patch draws its own, finer terrain here.
      if (vWorld.x > uPatchRect.x && vWorld.x < uPatchRect.z && vWorld.z > uPatchRect.y && vWorld.z < uPatchRect.w) discard;
    #endif

    vec2 hd = texture2D(uHeight, vUv).rg;
    float h = hd.r;
    vec3 n = normalize(texture2D(uNormal, vUv).xyz * 2.0 - 1.0);
    vec4 s = texture2D(uSurface, vUv);
    vec2 wp = vWorld.xz * 1000.0; // metres
    float fp = max(fwidth(wp.x), fwidth(wp.y)); // metres per pixel

    float park = s.g;
    #ifdef PATCH
      float canopy = hd.g;
      float dens = s.b;
      float sv = s.r * 255.0 - 128.0;
      float sdfM = sign(sv) * pow(abs(sv) / uSdfK, 2.0);
      // Within 250 m of its edge the patch blends into what the base map shows there, so the
      // boundary never reads as a line.
      vec2 toEdgeP = min(vUv, 1.0 - vUv) * uRegion.zw;
      float ew = smoothstep(0.0, 0.25, min(toEdgeP.x, toEdgeP.y));
      if (ew < 1.0) {
        vec2 buv = (vWorld.xz - uBaseRegion.xy) / uBaseRegion.zw;
        vec2 bhd = texture2D(uBaseHeight, buv).rg;
        vec4 bs = texture2D(uBaseSurface, buv);
        vec3 bn = normalize(texture2D(uBaseNormal, buv).xyz * 2.0 - 1.0);
        float bCanopy = bs.b * (1.0 - smoothstep(0.05, 0.45, bhd.g) * 0.72);
        float bSdf = (bs.r * 255.0 - 128.0) / uSdfLevels * uBaseSurfPxM;
        h = mix(bhd.r, h, ew);
        n = normalize(mix(bn, n, ew));
        canopy = mix(bCanopy, canopy, ew);
        dens = mix(bhd.g, dens, ew);
        sdfM = mix(bSdf, sdfM, ew);
        park = mix(bs.g, park, ew);
      }
    #else
      float dens = hd.g;
      // Regional forest polygons cover whole neighbourhoods; thin them where it's built up,
      // as the patch does by cutting out roofs and streets.
      float canopy = s.b * (1.0 - smoothstep(0.05, 0.45, dens) * 0.72);
      float sdfM = (s.r * 255.0 - 128.0) / uSdfLevels * uSurfPxM;
    #endif

    // Land: prairie cream in the east, limestone and cedar in the hills.
    float tH = smoothstep(120.0, 370.0, h);
    vec3 land = mix(lin(vec3(0.929, 0.898, 0.824)), lin(vec3(0.855, 0.820, 0.706)), tH);
    float slope = 1.0 - n.y;
    land = mix(land, lin(vec3(0.73, 0.74, 0.60)), smoothstep(0.03, 0.16, slope) * (0.25 + 0.45 * tH));
    #ifdef PATCH
      // Lawns read greener up close.
      land = mix(land, mix(lin(vec3(0.77, 0.81, 0.63)), lin(vec3(0.74, 0.80, 0.58)), ew), park * 0.62);
    #else
      land = mix(land, lin(vec3(0.77, 0.81, 0.63)), park * 0.6);
    #endif
    // Tree canopy (live oak, cedar elm, Ashe juniper), mottled like crowns seen from above;
    // the mottling fades out before it can shimmer at a distance.
    float mott = vnoise(wp * 0.11) * 0.6 + vnoise(wp * 0.37) * 0.4;
    mott = mix(0.5, mott, 1.0 - smoothstep(3.0, 10.0, fp));
    vec3 crown = mix(lin(vec3(0.47, 0.56, 0.37)), lin(vec3(0.61, 0.67, 0.45)), mott);
    // Softer from altitude, so the region still reads as a paper map.
    land = mix(land, crown, canopy * mix(0.72, 0.45, uZoomOut));
    land = mix(land, lin(vec3(0.86, 0.845, 0.815)), smoothstep(0.05, 0.6, dens) * 0.55 * (1.0 - canopy));

    float diff = max(dot(n, uSunDir), 0.0);
    float skyl = 0.6 + 0.4 * n.y;
    vec3 col = land * (uAmbient * skyl * 0.72 + uSunColor * diff * 0.5);

    // Contours every 20 m, index contours every 100 m; fade out before they moiré.
    float c20 = band(h / 20.0, 1.0) * (1.0 - smoothstep(0.1, 0.35, fwidth(h / 20.0)));
    float c100 = band(h / 100.0, 1.6) * (1.0 - smoothstep(0.06, 0.25, fwidth(h / 100.0)));
    float contour = (c20 * 0.28 + c100 * 0.42) * (1.0 - 0.75 * uNight) * (1.0 - canopy * 0.6);
    col = mix(col, col * mix(lin(vec3(0.58, 0.45, 0.30)), lin(vec3(0.5, 0.62, 0.85)), uNight), contour);

    // ---- Water (signed distance in metres, + on water) ----
    float aa = max(fwidth(sdfM), 0.35);
    float water = smoothstep(-aa, aa, sdfM);
    if (water > 0.001) {
      vec3 body = mix(lin(vec3(0.58, 0.76, 0.76)), lin(vec3(0.36, 0.60, 0.64)), smoothstep(6.0, 160.0, sdfM));
      // Engraved waterlines following the shore, like an old survey map; they give way to the
      // moving surface up close.
      float wl = 0.0;
      for (int k = 1; k <= 3; k++) {
        float r = float(k) * 34.0;
        wl += (1.0 - smoothstep(0.45 * aa, 1.3 * aa, abs(sdfM - r))) * (1.05 - float(k) * 0.28);
      }
      wl *= (1.0 - smoothstep(8.0, 30.0, aa)) * smoothstep(0.6, 2.0, fp);
      body *= 1.0 - wl * 0.16;

      vec2 g = waterSlope(wp, uTime, fp) * smoothstep(-2.0, 6.0, sdfM);
      vec3 wn = normalize(vec3(-g.x, 1.0, -g.y));
      vec3 V = normalize(uCamPos - vWorld);
      float wdiff = max(dot(wn, uSunDir), 0.0);
      vec3 wcol = body * (uAmbient * 0.72 + uSunColor * (0.28 + 0.12 * wdiff));
      // Sky reflection with Fresnel, then the sun's glitter path.
      vec3 R = reflect(-V, wn);
      vec3 skyc = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.35));
      float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(wn, V), 0.0, 1.0), 5.0);
      wcol = mix(wcol, skyc, clamp(fres, 0.0, 1.0) * 0.55);
      vec3 Hs = normalize(uSunDir + V);
      float nh = max(dot(wn, Hs), 0.0);
      float glint = pow(nh, 420.0) * 7.0 + pow(nh, 60.0) * 0.18;
      float sunUp = smoothstep(-0.02, 0.08, uSunDir.y);
      wcol += uSunColor * glint * sunUp * (1.0 - uNight);

      // Night: dark water carrying the city's lights near lit shores.
      wcol = mix(wcol, lin(vec3(0.035, 0.075, 0.12)) + skyc * 0.08, uNight * 0.9);
      float nearCity = smoothstep(0.02, 0.4, dens) * (1.0 - smoothstep(0.0, 140.0, sdfM));
      // Broken reflections: streaks stretched across the ripples, drifting with them.
      float shimmer = pow(vnoise(vec2(wp.x * 0.22, wp.y * 1.3) + vec2(0.0, uTime * 0.6) + g * 3.0), 4.0);
      float nightK = smoothstep(0.4, 1.0, uNight);
      wcol += lin(vec3(1.0, 0.72, 0.42)) * nearCity * (0.1 + 2.4 * shimmer) * nightK;
      wcol += lin(vec3(0.55, 0.62, 0.95)) * pow(vnoise(wp * 0.5 + uTime * 0.4), 8.0) * 0.25 * nightK;

      // Lapping at the shoreline, visible when close.
      float lapW = 1.1 + 0.7 * sin(uTime * 1.6 + vnoise(wp * 0.05) * 12.0);
      float lap = (1.0 - smoothstep(0.0, lapW, sdfM)) * step(0.0, sdfM) * (1.0 - smoothstep(0.8, 3.0, fp));
      wcol = mix(wcol, lin(vec3(0.93, 0.95, 0.92)) * (uAmbient * 0.8 + uSunColor * 0.3), lap * 0.45 * (1.0 - uNight));

      col = mix(col, wcol, water);
    }
    float shore = 1.0 - smoothstep(0.0, 1.4 * aa, abs(sdfM));
    col = mix(col, col * 0.72, shore * 0.45 * (1.0 - uNight) * smoothstep(0.8, 3.0, fp));

    // Night: the land drops away and built-up areas light up as points, at two scales so
    // there is sparkle both up close (streetlights) and from altitude (neighbourhoods).
    col *= 1.0 - uNight * 0.82;
    float urban = smoothstep(0.03, 0.75, dens) * (1.0 - water) * (1.0 - canopy * 0.7);
    float dark = smoothstep(0.3, 1.0, uNight);
    vec2 c1 = vWorld.xz * 55.0; // ~18 m
    vec2 f1 = fract(c1) - 0.5 + (vec2(hash(floor(c1) + 7.1), hash(floor(c1) + 3.3)) - 0.5) * 0.5;
    float d1 = step(0.8 - 0.1 * dark, hash(floor(c1))) * (1.0 - smoothstep(0.05, 0.15, length(f1)));
    float far1 = smoothstep(0.35, 1.2, max(fwidth(c1).x, fwidth(c1).y));
    vec2 c2 = vWorld.xz * 7.0; // ~140 m
    vec2 f2 = fract(c2) - 0.5 + (vec2(hash(floor(c2) + 1.7), hash(floor(c2) + 9.2)) - 0.5) * 0.6;
    float d2 = step(0.45, hash(floor(c2) + 0.5)) * (1.0 - smoothstep(0.06, 0.2, length(f2)));
    float far2 = smoothstep(0.35, 1.2, max(fwidth(c2).x, fwidth(c2).y));
    float lights = mix(d1, mix(d2 * 0.55, 0.07, far2), far1);
    col += lin(vec3(1.0, 0.74, 0.44)) * urban * (0.025 + 1.1 * lights) * dark;

    #ifndef PATCH
      // The map is a sheet on paper: its edges fade into the ground colour along an uneven,
      // deckled line. Kept within ~8 km of the edge so the Rocket Ranch (8.8 km in) stays clear.
      vec2 toEdge = min(vUv, 1.0 - vUv) * uRegion.zw;
      float wob = vnoise(vWorld.xz * 0.14) * 0.7 + vnoise(vWorld.xz * 0.6) * 0.3;
      float edge = smoothstep(0.0, 5.5, min(toEdge.x, toEdge.y) - wob * 2.2);
      col = mix(uGround, col, edge);
    #endif
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

function terrainMaterial(tex: AtlasTextures, patch: boolean, sdfK = 7.33, base?: AtlasTextures): THREE.ShaderMaterial {
  const baseUniforms: Record<string, THREE.IUniform> = base
    ? {
        uBaseHeight: { value: base.height },
        uBaseNormal: { value: base.normal },
        uBaseSurface: { value: base.surface },
        uBaseRegion: { value: new THREE.Vector4(X_MIN, Z_MIN, WIDTH_KM, HEIGHT_KM) },
        uBaseSurfPxM: { value: (WIDTH_KM * 1000) / base.surface.image.width },
      }
    : {};
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    defines: patch ? { PATCH: "" } : {},
    fog: true,
    // Pushed back so roads and paths drawn just above the ground always win.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uHeight: { value: tex.height },
      uNormal: { value: tex.normal },
      uSurface: { value: tex.surface },
      uRegion: {
        value: patch
          ? new THREE.Vector4(CX_MIN, CZ_MIN, C_WIDTH_KM, C_HEIGHT_KM)
          : new THREE.Vector4(X_MIN, Z_MIN, WIDTH_KM, HEIGHT_KM),
      },
      // The base terrain gives way inside the patch (a hair inside, so there is never a gap).
      uPatchRect: { value: new THREE.Vector4(CX_MIN + 0.001, CZ_MIN + 0.001, CX_MAX - 0.001, CZ_MAX - 0.001) },
      uExag: { value: TERRAIN_EXAG },
      uBase: { value: BASE_ELEV_M },
      uSurfPxM: { value: (WIDTH_KM * 1000) / tex.surface.image.width },
      uSdfLevels: { value: 4 },
      uSdfK: { value: sdfK },
      uSunColor: sky.uSunColor,
      uSunDir: sky.uSunDir,
      uAmbient: sky.uAmbient,
      uHorizon: sky.uHorizon,
      uZenith: sky.uZenith,
      uCamPos: sky.uCamPos,
      uNight: sky.uNight,
      uTime: sky.uTime,
      uZoomOut: sky.uZoomOut,
      uGround: sky.uGround,
      ...baseUniforms,
    },
  });
}

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

  const material = useMemo(() => terrainMaterial(tex, false), [tex]);

  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

/** Skirt depth below the patch edge (world km): hides any crack against the coarser base mesh. */
const SKIRT = 0.04;

/** The patch grid as a mesh, plus a skirt hanging from its edge. */
function patchGeometry(grid: PatchGrid): THREE.BufferGeometry {
  const { nx, nz, data } = grid;
  const nGrid = nx * nz;
  const ring: number[] = [];
  for (let i = 0; i < nx; i++) ring.push(i);
  for (let j = 1; j < nz; j++) ring.push(j * nx + nx - 1);
  for (let i = nx - 2; i >= 0; i--) ring.push((nz - 1) * nx + i);
  for (let j = nz - 2; j >= 1; j--) ring.push(j * nx);
  const pos = new Float32Array((nGrid + ring.length) * 3);
  for (let j = 0; j < nz; j++) {
    const z = CZ_MIN + (j / (nz - 1)) * C_HEIGHT_KM;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      pos[k * 3] = CX_MIN + (i / (nx - 1)) * C_WIDTH_KM;
      pos[k * 3 + 1] = elevToY(data[k]);
      pos[k * 3 + 2] = z;
    }
  }
  ring.forEach((k, r) => {
    const o = (nGrid + r) * 3;
    pos[o] = pos[k * 3];
    pos[o + 1] = pos[k * 3 + 1] - SKIRT;
    pos[o + 2] = pos[k * 3 + 2];
  });
  const idx = new Uint32Array(((nx - 1) * (nz - 1) + ring.length) * 6);
  let t = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      idx[t++] = a;
      idx[t++] = c;
      idx[t++] = b;
      idx[t++] = b;
      idx[t++] = c;
      idx[t++] = d;
    }
  }
  for (let r = 0; r < ring.length; r++) {
    const a = ring[r];
    const b = ring[(r + 1) % ring.length];
    const a2 = nGrid + r;
    const b2 = nGrid + ((r + 1) % ring.length);
    idx[t++] = a;
    idx[t++] = b;
    idx[t++] = a2;
    idx[t++] = b;
    idx[t++] = b2;
    idx[t++] = a2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Central Austin at street scale: ~16 m terrain with 4 m water, parks and tree canopy. */
export function CentralTerrain({
  tex,
  baseTex,
  grid,
  sdfK,
}: {
  tex: AtlasTextures;
  baseTex: AtlasTextures;
  grid: PatchGrid;
  sdfK: number;
}) {
  const geometry = useMemo(() => patchGeometry(grid), [grid]);
  const material = useMemo(() => {
    const m = terrainMaterial(tex, true, sdfK, baseTex);
    // The skirt faces outwards and inwards depending on the edge.
    m.side = THREE.DoubleSide;
    return m;
  }, [tex, sdfK, baseTex]);
  return <mesh geometry={geometry} material={material} />;
}
