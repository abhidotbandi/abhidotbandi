"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BUILDING_EXAG } from "@/lib/atlas/geo";
import { runtime } from "@/lib/atlas/store";
import { sky } from "@/lib/atlas/timeOfDay";
import { SHADOW_FRAGMENT_PARS, SHADOW_VERTEX_PARS, shadowUniforms, shadowVertex } from "./shadows";
import { aoCaster } from "./Occlusion";
import { MAX_SITES, siteUniforms } from "./siteState";

const vertex = /* glsl */ `
  attribute vec4 aInfo;
  attribute float aU;
  uniform float uGrow;
  varying vec3 vWorld;
  varying vec4 vInfo;
  varying float vU;
  #include <fog_pars_vertex>
  ${SHADOW_VERTEX_PARS}
  void main() {
    // Buildings rise out of the ground as a detail tile arrives (uGrow 0 -> 1). Rooftop plant
    // stands on the roof, not the ground, so it waits below the terrain until they're up.
    vec3 p = position;
    p.y = aInfo.y + (p.y - aInfo.y) * uGrow;
    if (aInfo.x < -1.5 && aInfo.x > -2.5) p.y -= step(uGrow, 0.999) * 10.0;
    vWorld = p;
    vInfo = aInfo;
    vU = aU;
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
    ${shadowVertex("p")}
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
  uniform vec4 uSite[${MAX_SITES}]; // rgb = colour (linear), a = emphasis 0..1 (<0: filtered out)
  uniform float uBuildingExag;
  varying vec3 vWorld;
  varying vec4 vInfo;
  varying float vU;
  #include <fog_pars_fragment>
  ${SHADOW_FRAGMENT_PARS}

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
    // A style (UT's campus, West Campus, the Capitol and the state's offices around it) rides in
    // the whole part of the per-building random.
    float style = floor(vInfo.w + 1e-4);
    float r = vInfo.w - style;
    bool campus = style > 0.5 && style < 2.5;
    bool westCampus = style > 2.5 && style < 3.5;
    bool capitol = style > 3.5 && style < 4.5;
    bool state = style > 4.5 && style < 5.5;
    bool plant = kind < -1.5 && kind > -2.5;
    bool pitched = kind < -2.5 && kind > -3.5;
    bool pool = kind < -3.5 && kind > -4.5;
    bool glass = hM >= 45.0 && !plant && !pool && style < 0.5;

    float roof = smoothstep(0.7, 0.9, n.y);
    float wall = 1.0 - smoothstep(0.3, 0.5, abs(n.y));
    vec3 paper = lin(vec3(0.972, 0.955, 0.918)) * mix(0.9, 1.0, roof);

    // Materials by type.
    vec3 walls;
    // UT's Leuders limestone and buff brick; West Campus's stucco and brick.
    if (campus) walls = pick(r, lin(vec3(0.91, 0.85, 0.72)), lin(vec3(0.85, 0.74, 0.57)), lin(vec3(0.93, 0.88, 0.77)), lin(vec3(0.8, 0.67, 0.5)));
    else if (westCampus) walls = pick(r, lin(vec3(0.92, 0.88, 0.8)), lin(vec3(0.71, 0.45, 0.36)), lin(vec3(0.8, 0.78, 0.74)), lin(vec3(0.87, 0.74, 0.58)));
    // The Capitol's sunset-red granite; the state's Texas limestone and pink and grey granite.
    else if (capitol) walls = lin(vec3(0.78, 0.56, 0.47));
    else if (state) walls = pick(r, lin(vec3(0.92, 0.88, 0.78)), lin(vec3(0.88, 0.8, 0.67)), lin(vec3(0.94, 0.91, 0.83)), lin(vec3(0.84, 0.69, 0.6)));
    // Towers in blue, teal, steel and bronze glass; mid-rises in limestone, sand, concrete and
    // brick; houses painted white, butter, pale blue and terracotta.
    else if (glass) walls = pick(r, lin(vec3(0.38, 0.56, 0.76)), lin(vec3(0.3, 0.58, 0.64)), lin(vec3(0.64, 0.72, 0.8)), lin(vec3(0.58, 0.5, 0.42)));
    else if (hM >= 10.0) walls = pick(r, lin(vec3(0.95, 0.89, 0.77)), lin(vec3(0.88, 0.75, 0.55)), lin(vec3(0.87, 0.87, 0.85)), lin(vec3(0.74, 0.43, 0.32)));
    else walls = pick(r, lin(vec3(0.97, 0.96, 0.93)), lin(vec3(0.95, 0.85, 0.6)), lin(vec3(0.7, 0.8, 0.88)), lin(vec3(0.9, 0.66, 0.5)));
    vec3 mat;
    if (pitched) {
      // Houses: mostly grey and brown shingle and galvanised metal, some slate, a few in tile.
      float q = fract(r * 7.13);
      vec3 house = q < 0.3 ? lin(vec3(0.4, 0.41, 0.44)) : q < 0.55 ? lin(vec3(0.52, 0.4, 0.32)) : q < 0.8 ? lin(vec3(0.66, 0.7, 0.74))
        : q < 0.92 ? lin(vec3(0.31, 0.35, 0.42)) : lin(vec3(0.72, 0.42, 0.29));
      vec3 shingle = campus
        ? pick(q, lin(vec3(0.72, 0.34, 0.22)), lin(vec3(0.65, 0.29, 0.19)), lin(vec3(0.77, 0.4, 0.26)), lin(vec3(0.69, 0.36, 0.26)))
        : house;
      mat = n.y > 0.3 ? shingle : walls;
      if (campus) {
        // Courses of clay tile down the slope, faint, gone before they'd shimmer.
        float tc = dot(vWorld.xz, normalize(n.xz + vec2(1e-4))) * 1000.0 / 0.6;
        float d = 1.0 - smoothstep(0.3, 0.7, fwidth(tc));
        mat *= 1.0 - 0.14 * smoothstep(0.6, 1.0, fract(tc)) * d;
      }
    } else if (plant) {
      mat = lin(vec3(0.56, 0.57, 0.6));
    } else if (pool) {
      mat = lin(vec3(0.3, 0.68, 0.8));
    } else {
      mat = mix(walls, capitol ? lin(vec3(0.6, 0.55, 0.5)) : state ? lin(vec3(0.78, 0.75, 0.7)) : lin(vec3(0.86, 0.85, 0.82)), roof);
    }

    // Facade detail by day, faded out before it can shimmer.
    // The Capitol's storeys are tall (four in 24 m), its window bays wide.
    float u = vU / (capitol ? 4.4 : 3.4);
    float fl = (vWorld.y - vInfo.y) * 1000.0 / uBuildingExag / (capitol ? 6.0 : 3.9);
    float fw = max(fwidth(u), fwidth(fl));
    // Company buildings keep their materials from further out than the paper city around them.
    float detailK = isSite || campus || capitol || state ? max(uDetail, 0.9) : uDetail;
    float detail = detailK * wall * (1.0 - smoothstep(0.3, 0.7, fw));
    // Metres above the street (walls start 3 m below it, at their lowest corner); above the
    // roofline, the parapet: no windows in it.
    float streetM = (vWorld.y - vInfo.y) * 1000.0 / uBuildingExag - 3.0 / uBuildingExag;
    float parapet = step(hM, streetM);
    detail *= 1.0 - parapet;
    if (!pitched && !plant && !pool && hM >= 10.0) {
      if (glass) {
        float m = fract(vU / 1.6);
        float mull = 1.0 - smoothstep(0.0, 0.07, min(m, 1.0 - m));
        float s = fract(fl);
        float slab = 1.0 - smoothstep(0.0, 0.09, min(s, 1.0 - s));
        vec3 view = normalize(uCamPos - vWorld);
        float fres = pow(1.0 - max(dot(view, n), 0.0), 3.0);
        mat = mix(mat, mix(uHorizon, uZenith, 0.55), (0.25 + 0.45 * fres) * detail);
        // Panel by panel, the glass catches the sky a little differently.
        float pane = hash(floor(vec2(vU / 1.6, fl)) + r * 71.0);
        mat *= 1.0 + (pane - 0.5) * 0.18 * detail;
        mat *= 1.0 - 0.3 * max(mull * 0.7, slab) * detail;
      } else if (westCampus) {
        // Apartment towers: wide windows, and a balcony slab at every floor.
        vec2 f = vec2(fract(u), fract(fl));
        float win = step(0.12, f.x) * step(f.x, 0.88) * step(0.2, f.y) * step(f.y, 0.92);
        mat = mix(mat, mat * vec3(0.46, 0.53, 0.62), win * detail * 0.8);
        mat = mix(mat, lin(vec3(0.95, 0.94, 0.9)), (1.0 - step(0.1, f.y)) * detail * 0.5);
      } else if (capitol) {
        // Tall windows between pilasters, over a rusticated ground floor.
        vec2 f = vec2(fract(u), fract(fl));
        float win = step(0.3, f.x) * step(f.x, 0.7) * step(0.22, f.y) * step(f.y, 0.8);
        float pil = step(0.9, f.x) + step(f.x, 0.06);
        mat = mix(mat, mat * 1.12, pil * step(1.0, fl) * detail * 0.6);
        mat = mix(mat, mat * vec3(0.42, 0.44, 0.5), win * detail * 0.75);
        float rust = smoothstep(0.0, 0.05, abs(fract(fl * 5.0) - 0.5) - 0.42);
        mat *= 1.0 - (0.06 + 0.12 * rust) * step(fl, 1.0) * detail;
      } else {
        vec2 f = vec2(fract(u), fract(fl));
        float win = step(0.24, f.x) * step(f.x, 0.76) * step(0.3, f.y) * step(f.y, 0.82);
        mat = mix(mat, mat * vec3(0.5, 0.56, 0.64), win * detail * 0.7);
      }
    }

    if (!pitched && !plant && !pool && hM >= 8.0) {
      // Shopfronts and lobbies: the ground floor glazed dark under a pale fascia, read from
      // further out than the windows above. (The Capitol and UT keep their stone.)
      if (!capitol && !campus) {
        float aa = max(fwidth(streetM), 1e-3);
        float gf = detailK * wall * (1.0 - smoothstep(0.8, 1.8, aa));
        float shop = smoothstep(0.3 - aa, 0.3 + aa, streetM) * (1.0 - smoothstep(4.0 - aa, 4.0 + aa, streetM));
        float fascia = smoothstep(4.0 - aa, 4.0 + aa, streetM) * (1.0 - smoothstep(4.7 - aa, 4.7 + aa, streetM));
        mat = mix(mat, lin(vec3(0.16, 0.19, 0.23)) + uHorizon * 0.12, shop * gf * 0.8);
        mat = mix(mat, lin(vec3(0.93, 0.91, 0.86)), fascia * gf * 0.55);
      }
      // The parapet's coping: glass towers capped in pale metal.
      if (glass) mat = mix(mat, lin(vec3(0.8, 0.82, 0.85)), parapet * wall);
    }

    vec3 base = mix(paper, mat, detailK);
    if (isSite) base = mix(base, site.rgb, 0.55 + 0.4 * emph);

    float rel = clamp((vWorld.y - vInfo.y) / max(1e-4, hM * 0.001 * uBuildingExag), 0.0, 1.0);
    // Toy-model shading: the walls darken toward the ground they stand in (the first few metres),
    // the roofline catches a bright edge, and the sun is shadowed by whatever stands in its way.
    float above = (vWorld.y - vInfo.y) * 1000.0 / uBuildingExag; // metres up the wall
    float ao = mix(0.6, 1.0, smoothstep(0.0, 8.0, above)) * mix(0.9, 1.0, smoothstep(0.0, 0.5, rel));
    float diff = max(dot(n, uSunDir), 0.0) * sunShadow(n, uSunDir) * cloudShadow(vWorld, uSunDir);
    // Contact shadows: walls darker down narrow streets, roofs beside taller towers.
    float open = skyOpen(vWorld, n);
    vec3 col = base * (uAmbient * (0.52 + 0.48 * n.y) * ao * open * 0.9 + uSunColor * diff * 0.7 * mix(1.0, open, 0.25));
    if (wall > 0.5 && !pitched && !plant && !pool) {
      float below = hM - streetM; // metres under the roofline (negative on the parapet)
      float line = 1.0 - smoothstep(0.25, 0.25 + max(fwidth(below) * 1.5, 0.4), below);
      col *= 1.0 + 0.16 * line;
    }

    col *= 1.0 - uNight * 0.84;
    // The Capitol is floodlit after dark, like the stone of the landmarks.
    if (capitol) col += mix(vec3(0.26, 0.19, 0.14), walls * 0.5, 0.45) * uNight * mix(1.1, 0.85, rel) * (0.4 + 0.6 * wall);
    // Lit windows after dark.
    if (wall > 0.5 && !plant && !pitched && !pool) {
      // Fewer windows lit at dusk than at full night, and fewer in houses than in towers.
      float dark = smoothstep(0.35, 1.0, uNight);
      float share = hM > 10.0 ? 0.86 - 0.18 * dark : 0.9 - 0.12 * dark;
      float lit = step(0.3, fract(u)) * step(0.35, fract(fl)) * step(share, hash(floor(vec2(u, fl)) + r * 97.0));
      float far = smoothstep(0.35, 1.1, fwidth(u));
      col += lin(vec3(1.0, 0.8, 0.5)) * mix(lit, 0.12, far) * dark * 0.9;
    }
    if (pool) {
      // The sky in the water by day; lit from below after dark.
      vec3 view = normalize(uCamPos - vWorld);
      float fres = pow(1.0 - max(dot(view, n), 0.0), 3.0);
      col = mix(col, mix(uHorizon, uZenith, 0.5) * (1.0 - uNight * 0.8), fres * 0.4);
      col += lin(vec3(0.25, 0.78, 0.95)) * smoothstep(0.35, 1.0, uNight) * 0.55;
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

/** Shared across every building mesh: 0 = paper city (far), 1 = full detail (near). */
const detail = { value: 0 };

/** The building material. Each one has its own `uGrow`; everything else is shared. */
export function makeBuildingMaterial(grow = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    fog: true,
    side: THREE.DoubleSide,
    lights: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...shadowUniforms(),
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
      uGrow: { value: grow },
    },
  });
}

export default function Buildings({ geometry }: { geometry: THREE.BufferGeometry }) {
  const material = useMemo(() => makeBuildingMaterial(), []);
  useFrame(() => {
    detail.value = THREE.MathUtils.clamp((14 - runtime.cam.dist) / 8, 0, 1);
  });
  return <mesh geometry={geometry} material={material} castShadow receiveShadow onUpdate={aoCaster} />;
}
