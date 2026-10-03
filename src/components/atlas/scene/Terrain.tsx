"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { SHADOW_FRAGMENT_PARS, SHADOW_VERTEX_PARS, shadowUniforms, shadowVertex } from "./shadows";
import type { AtlasTextures } from "./textures";
import { waterUniforms } from "./Water";
import { sky } from "@/lib/atlas/timeOfDay";
import { FIELD } from "@/lib/atlas/airport";
import {
  BASE_ELEV_M,
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
  #ifdef OUTER
    uniform sampler2D uOuterHeight;
    uniform vec4 uOuterRegion;
  #endif
  varying vec2 vUv;
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  ${SHADOW_VERTEX_PARS}

  void main() {
    vec3 p = position;
    vec2 uv = (p.xz - uRegion.xy) / uRegion.zw;
    #ifndef PATCH
      float h = texture2D(uHeight, clamp(uv, 0.0, 1.0)).r;
      #ifdef OUTER
        // Beyond the map the grid carries on over the country around it, easing from the map's
        // edge onto the coarse relief within 3 km, so there is no step.
        float dOut = length(max(max(uRegion.xy - p.xz, p.xz - uRegion.xy - uRegion.zw), 0.0));
        if (dOut > 0.0) {
          float ho = texture2D(uOuterHeight, (p.xz - uOuterRegion.xy) / uOuterRegion.zw).r;
          h = mix(h, ho, smoothstep(0.0, 3.0, dOut));
        }
      #endif
      p.y = (h - uBase) / 1000.0 * uExag;
    #endif
    vUv = uv;
    vWorld = p;
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
    ${shadowVertex("p")}
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
  uniform sampler2D uWaterNormals;
  uniform sampler2D uReflection;
  uniform mat4 uReflMatrix;
  uniform float uReflOn;
  uniform float uReflY;
  #ifdef OUTER
    uniform sampler2D uOuterHeight;
    uniform sampler2D uOuterNormal;
    uniform vec4 uOuterRegion;
    uniform float uOuterSdfLevels;
    uniform float uOuterPxM;
  #endif
  #ifdef FIELD_N
    // Austin-Bergstrom's airfield: its boundary (scene km), and the box round it.
    uniform vec2 uField[FIELD_N];
    uniform vec4 uFieldBox;
  #endif
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
  ${SHADOW_FRAGMENT_PARS}

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

  #ifdef FIELD_N
    // Signed distance (km) to the airfield's boundary, less than 0 inside.
    float fieldDist(vec2 p) {
      float d = 1e9;
      bool inside = false;
      vec2 a = uField[FIELD_N - 1];
      for (int i = 0; i < FIELD_N; i++) {
        vec2 b = uField[i];
        vec2 e = b - a;
        vec2 w = p - a;
        vec2 q = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
        d = min(d, dot(q, q));
        if ((a.y > p.y) != (b.y > p.y) && p.x < a.x + (p.y - a.y) * e.x / e.y) inside = !inside;
        a = b;
      }
      return (inside ? -1.0 : 1.0) * sqrt(d);
    }
  #endif

  #ifdef PATCH
    // Signed water distance (metres, + on water) from the patch's surface texture.
    float sdfAt(vec2 uv) {
      float sv = texture2D(uSurface, uv).r * 255.0 - 128.0;
      return sign(sv) * pow(abs(sv) / uSdfK, 2.0);
    }
  #endif

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
      #ifdef OUTER
        // Signed distance to the map's edge (km, + outside) and an uneven line to fade along.
        vec2 toEdgeR = min(vUv, 1.0 - vUv) * uRegion.zw;
        float dOut = length(max(max(uRegion.xy - vWorld.xz, vWorld.xz - uRegion.xy - uRegion.zw), 0.0));
        float sd = dOut > 0.0 ? dOut : -min(toEdgeR.x, toEdgeR.y);
        float wobE = vnoise(vWorld.xz * 0.14) * 0.7 + vnoise(vWorld.xz * 0.6) * 0.3;
        // The map's tints (woods, parks) thin out over its last few km...
        float tints = 1.0 - smoothstep(-5.0, -0.3, sd + wobE * 1.8);
        canopy *= tints;
        park *= tints;
        // ...and beyond it the country takes over: its relief, shading and water.
        if (sd > -1.0) {
          vec2 ouv = (vWorld.xz - uOuterRegion.xy) / uOuterRegion.zw;
          vec2 od = texture2D(uOuterHeight, ouv).rg;
          vec3 on = normalize(texture2D(uOuterNormal, ouv).xyz * 2.0 - 1.0);
          float kH = smoothstep(0.0, 3.0, sd);
          h = mix(h, od.r, kH);
          n = normalize(mix(n, on, kH));
          float oSdf = (od.g * 255.0 - 128.0) / uOuterSdfLevels * uOuterPxM;
          sdfM = mix(sdfM, oSdf, smoothstep(-0.8, 0.8, sd));
          dens *= 1.0 - smoothstep(-0.3, 0.3, sd);
        }
      #endif
    #endif

    // Land: prairie sand in the east, limestone and cedar in the hills.
    float tH = smoothstep(120.0, 370.0, h);
    vec3 land = mix(lin(vec3(0.925, 0.866, 0.73)), lin(vec3(0.86, 0.80, 0.63)), tH);
    float slope = 1.0 - n.y;
    land = mix(land, lin(vec3(0.66, 0.72, 0.48)), smoothstep(0.03, 0.16, slope) * (0.25 + 0.45 * tH));
    #ifdef PATCH
      // Lawns read greener up close.
      land = mix(land, mix(lin(vec3(0.66, 0.81, 0.45)), lin(vec3(0.58, 0.79, 0.37)), ew), park * 0.7);
    #else
      land = mix(land, lin(vec3(0.66, 0.81, 0.45)), park * 0.65);
    #endif
    #ifdef FIELD_N
      // The airfield, mown between the runways and taxiways: olive turf (as it is from the air),
      // in stripes where the mowers ran north-south, with drier, yellower patches.
      if (vWorld.x > uFieldBox.x && vWorld.x < uFieldBox.z && vWorld.z > uFieldBox.y && vWorld.z < uFieldBox.w) {
        float field = 1.0 - smoothstep(-0.04, 0.005, fieldDist(vWorld.xz));
        if (field > 0.0) {
          float dry = vnoise(wp * 0.0045) * 0.65 + vnoise(wp * 0.021) * 0.35;
          vec3 turf = mix(lin(vec3(0.55, 0.65, 0.36)), lin(vec3(0.7, 0.7, 0.46)), smoothstep(0.42, 0.85, dry));
          float mown = abs(fract(wp.x / 26.0) - 0.5) * 4.0 - 1.0;
          turf *= 1.0 + 0.06 * smoothstep(-0.3, 0.3, mown) * (1.0 - smoothstep(3.0, 9.0, fp));
          land = mix(land, turf, field);
        }
      }
    #endif
    // Tree canopy (live oak, cedar elm, Ashe juniper), mottled like crowns seen from above;
    // the mottling fades out before it can shimmer at a distance.
    float mott = vnoise(wp * 0.11) * 0.6 + vnoise(wp * 0.37) * 0.4;
    mott = mix(0.5, mott, 1.0 - smoothstep(3.0, 10.0, fp));
    vec3 crown = mix(lin(vec3(0.27, 0.52, 0.22)), lin(vec3(0.45, 0.68, 0.31)), mott);
    // A little softer from altitude, so the region still reads as a map.
    land = mix(land, crown, canopy * mix(0.8, 0.7, uZoomOut));
    land = mix(land, lin(vec3(0.86, 0.84, 0.80)), smoothstep(0.05, 0.6, dens) * 0.5 * (1.0 - canopy));

    // Shadows of the buildings, trees and landmarks, cooled by the sky's light in them.
    float sun = sunShadow(n, uSunDir) * cloudShadow(vWorld, uSunDir);
    float diff = max(dot(n, uSunDir), 0.0) * sun;
    float skyl = 0.6 + 0.4 * n.y;
    // Contact shadows: less sky beside and between buildings.
    float open = skyOpen(vWorld, n);
    vec3 col = land * (uAmbient * skyl * 0.78 * open + uSunColor * diff * 0.52 * mix(1.0, open, 0.35));

    // Contours every 20 m, index contours every 100 m; fade out before they moiré.
    float c20 = band(h / 20.0, 1.0) * (1.0 - smoothstep(0.1, 0.35, fwidth(h / 20.0)));
    float c100 = band(h / 100.0, 1.6) * (1.0 - smoothstep(0.06, 0.25, fwidth(h / 100.0)));
    float contour = (c20 * 0.28 + c100 * 0.42) * (1.0 - 0.75 * uNight) * (1.0 - canopy * 0.6);
    col = mix(col, col * mix(lin(vec3(0.58, 0.45, 0.30)), lin(vec3(0.5, 0.62, 0.85)), uNight), contour);

    // ---- Water (signed distance in metres, + on water) ----
    float aa = max(fwidth(sdfM), 0.35);
    float water = smoothstep(-aa, aa, sdfM);
    if (water > 0.001) {
      // Creeks (Waller, Shoal, Boggy...): water that is nowhere more than a few metres from a bank
      // within 9 m of here. They run in the shade of the trees along them: darker, greener and
      // stiller than open water, so they read as creeks, not rivers.
      float creek = 0.0;
      #ifdef PATCH
        vec2 du = vec2(0.009) / uRegion.zw;
        float deep = max(sdfM, max(max(sdfAt(vUv + vec2(du.x, 0.0)), sdfAt(vUv - vec2(du.x, 0.0))),
                                   max(sdfAt(vUv + vec2(0.0, du.y)), sdfAt(vUv - vec2(0.0, du.y)))));
        creek = (1.0 - smoothstep(4.5, 8.0, deep)) * ew;
      #endif
      // The water's own colour, seen through the surface: green-brown in the shallows by the
      // banks, where the bottom shows, and a deep blue-green further out.
      vec3 body = mix(lin(vec3(0.22, 0.36, 0.29)), lin(vec3(0.05, 0.18, 0.21)), smoothstep(1.0, 28.0, sdfM));
      body = mix(body, lin(vec3(0.12, 0.25, 0.19)), creek);

      // The surface: wind ripples from a tiling normal map at two scales drifting on the breeze
      // (mipmapped, so from afar they average out and the water mirrors more cleanly), and the
      // finer waves up close.
      vec2 g = waterSlope(wp, uTime, fp);
      vec3 r1 = texture2D(uWaterNormals, wp / 31.0 + vec2(0.017, 0.023) * uTime).xyz * 2.0 - 1.0;
      vec3 r2 = texture2D(uWaterNormals, mat2(0.8, -0.6, 0.6, 0.8) * wp / 113.0 + vec2(-0.006, 0.009) * uTime).xyz * 2.0 - 1.0;
      g += r1.xz / max(r1.y, 0.3) * 0.2 + r2.xz / max(r2.y, 0.3) * 0.28;
      g *= smoothstep(-2.0, 6.0, sdfM) * (1.0 - 0.6 * creek);
      vec3 wn = normalize(vec3(-g.x, 1.0, -g.y));
      vec3 V = normalize(uCamPos - vWorld);
      float wdiff = max(dot(wn, uSunDir), 0.0);
      vec3 bodyLit = body * (uAmbient * 0.7 + uSunColor * (0.22 + 0.1 * wdiff) * sun);
      bodyLit = mix(bodyLit, lin(vec3(0.02, 0.045, 0.07)), uNight * 0.9);
      // What the surface mirrors: the sky, and where the lake's reflection is rendered
      // (Water.tsx), the banks, trees and skyline too, broken up by the ripples.
      vec3 R = reflect(-V, wn);
      vec3 skyc = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.35));
      float mirrored = 0.0;
      if (uReflOn > 0.5) {
        vec4 rc = uReflMatrix * vec4(vWorld.x, uReflY, vWorld.z, 1.0);
        // Ripples break the reflection up, more across it than along (as they stretch it).
        vec2 ruv = rc.xy / rc.w + vec2(wn.x * 0.012, wn.z * 0.02);
        // Only the water at the reflected level (not a creek or lake at another).
        mirrored = 1.0 - smoothstep(0.004, 0.01, abs(vWorld.y - uReflY));
        skyc = mix(skyc, texture2D(uReflection, clamp(ruv, vec2(0.002), vec2(0.998))).rgb, mirrored);
      }
      float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(wn, V), 0.0, 1.0), 5.0);
      // A little more than the physics would give, so the reflections read from above.
      vec3 wcol = mix(bodyLit, skyc, clamp(0.3 + fres * 1.6, 0.0, 0.94) * (1.0 - 0.5 * creek));
      // The sun's glitter path, where nothing shades the water.
      vec3 Hs = normalize(uSunDir + V);
      float nh = max(dot(wn, Hs), 0.0);
      float glint = pow(nh, 420.0) * 4.5 + pow(nh, 60.0) * 0.14;
      float sunUp = smoothstep(-0.02, 0.08, uSunDir.y);
      wcol += uSunColor * glint * sunUp * sun * (1.0 - uNight) * (1.0 - 0.8 * creek);

      // Night, where the lake's reflection isn't rendered: the city's lights in the water as
      // broken streaks across the ripples.
      float nearCity = smoothstep(0.02, 0.4, dens) * (1.0 - smoothstep(0.0, 140.0, sdfM));
      float shimmer = pow(vnoise(vec2(wp.x * 0.22, wp.y * 1.3) + vec2(0.0, uTime * 0.6) + g * 3.0), 4.0);
      float nightK = smoothstep(0.4, 1.0, uNight) * (1.0 - mirrored);
      wcol += lin(vec3(1.0, 0.72, 0.42)) * nearCity * (0.02 + 0.45 * shimmer) * nightK;

      // Lapping at the shoreline, visible when close.
      float lapW = 1.1 + 0.7 * sin(uTime * 1.6 + vnoise(wp * 0.05) * 12.0);
      float lap = (1.0 - smoothstep(0.0, lapW, sdfM)) * step(0.0, sdfM) * (1.0 - smoothstep(0.8, 3.0, fp));
      wcol = mix(wcol, lin(vec3(0.9, 0.93, 0.9)) * (uAmbient * 0.8 + uSunColor * 0.3), lap * 0.3 * (1.0 - uNight) * (1.0 - creek));
      // The water is lit for the night already; the land is darkened below.
      wcol /= max(1.0 - uNight * 0.82, 0.05);

      col = mix(col, wcol, water);
    }
    // Wet banks: the ground darkens toward the waterline, up close.
    float wet = (1.0 - smoothstep(0.0, 3.0, -sdfM)) * step(sdfM, 0.0);
    col *= 1.0 - 0.2 * wet * (1.0 - smoothstep(1.5, 4.0, fp));

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
      // The country fades into the ground colour along an uneven line at its far edge (with no
      // country around it, the map itself does, within ~8 km of its edge).
      #ifdef OUTER
        vec2 ouvE = (vWorld.xz - uOuterRegion.xy) / uOuterRegion.zw;
        vec2 toEdge = min(ouvE, 1.0 - ouvE) * uOuterRegion.zw;
        float fadeKm = 16.0;
      #else
        vec2 toEdge = min(vUv, 1.0 - vUv) * uRegion.zw;
        float fadeKm = 5.5;
      #endif
      float wob = vnoise(vWorld.xz * 0.14) * 0.7 + vnoise(vWorld.xz * 0.6) * 0.3;
      float edge = smoothstep(0.0, fadeKm, min(toEdge.x, toEdge.y) - wob * 2.2);
      col = mix(uGround, col, edge);
    #endif
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

/** The airfield's boundary for the turf, and its bounding box (x0, z0, x1, z1). */
function fieldUniforms(): Record<string, THREE.IUniform> {
  const xs = FIELD.map((p) => p[0]);
  const zs = FIELD.map((p) => p[1]);
  return {
    uField: { value: FIELD.map(([x, z]) => new THREE.Vector2(x, z)) },
    uFieldBox: { value: new THREE.Vector4(Math.min(...xs) - 0.01, Math.min(...zs) - 0.01, Math.max(...xs) + 0.01, Math.max(...zs) + 0.01) },
  };
}

function terrainMaterial(
  tex: AtlasTextures,
  patch: boolean,
  sdfK = 7.33,
  base?: AtlasTextures,
  /** base terrain only: leave a hole for the central patch (once it has loaded) */
  cutout = true,
  /** base terrain only: the country around the map, x, z, width, height (km) */
  outerBounds?: [number, number, number, number],
): THREE.ShaderMaterial {
  const baseUniforms: Record<string, THREE.IUniform> = base
    ? {
        uBaseHeight: { value: base.height },
        uBaseNormal: { value: base.normal },
        uBaseSurface: { value: base.surface },
        uBaseRegion: { value: new THREE.Vector4(X_MIN, Z_MIN, WIDTH_KM, HEIGHT_KM) },
        uBaseSurfPxM: { value: (WIDTH_KM * 1000) / base.surface.image.width },
      }
    : {};
  const outer = !patch && tex.outer && outerBounds;
  const outerUniforms: Record<string, THREE.IUniform> = outer
    ? {
        uOuterHeight: { value: tex.outer!.height },
        uOuterNormal: { value: tex.outer!.normal },
        uOuterRegion: { value: new THREE.Vector4(...outerBounds!) },
        uOuterSdfLevels: { value: 4 },
        uOuterPxM: { value: (outerBounds![2] * 1000) / tex.outer!.height.image.width },
      }
    : {};
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    defines: patch ? { PATCH: "" } : { ...(outer ? { OUTER: "" } : {}), FIELD_N: FIELD.length },
    fog: true,
    // Pushed back so roads and paths drawn just above the ground always win.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
    lights: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...shadowUniforms(),
      ...waterUniforms(),
      uHeight: { value: tex.height },
      uNormal: { value: tex.normal },
      uSurface: { value: tex.surface },
      uRegion: {
        value: patch
          ? new THREE.Vector4(CX_MIN, CZ_MIN, C_WIDTH_KM, C_HEIGHT_KM)
          : new THREE.Vector4(X_MIN, Z_MIN, WIDTH_KM, HEIGHT_KM),
      },
      // The base terrain gives way inside the patch (a hair inside, so there is never a gap);
      // an empty rectangle while the patch is still loading.
      uPatchRect: {
        value: cutout
          ? new THREE.Vector4(CX_MIN + 0.001, CZ_MIN + 0.001, CX_MAX - 0.001, CZ_MAX - 0.001)
          : new THREE.Vector4(1, 1, 0, 0),
      },
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
      ...outerUniforms,
      ...(patch ? {} : fieldUniforms()),
    },
  });
}

/**
 * Grid lines along one axis: the map's own, exactly where a PlaneGeometry puts them (so the
 * ground sampling in geo.ts still matches), then steps growing outwards to `lo` and `hi`.
 */
function axis(min: number, max: number, seg: number, lo: number, hi: number): number[] {
  const step = (max - min) / seg;
  const inner = Array.from({ length: seg + 1 }, (_, i) => min + i * step);
  const grow = (from: number, to: number, dir: number) => {
    const out: number[] = [];
    let x = from;
    let s = step;
    while (dir < 0 ? x > to + 1e-6 : x < to - 1e-6) {
      s = Math.min(s * 1.15, 2.2);
      x = dir < 0 ? Math.max(to, x - s) : Math.min(to, x + s);
      out.push(x);
    }
    return out;
  };
  return [...grow(min, lo, -1).reverse(), ...inner, ...grow(max, hi, 1)];
}

/** The base terrain's grid: the map's, carried on over the country around it when there is one. */
function baseGeometry(segments: number, outer?: [number, number, number, number]): THREE.BufferGeometry {
  const segZ = Math.round((segments * HEIGHT_KM) / WIDTH_KM);
  const [ox, oz, ow, oh] = outer ?? [X_MIN, Z_MIN, WIDTH_KM, HEIGHT_KM];
  const xs = axis(X_MIN, X_MIN + WIDTH_KM, segments, Math.min(ox, X_MIN), Math.max(ox + ow, X_MIN + WIDTH_KM));
  const zs = axis(Z_MIN, Z_MIN + HEIGHT_KM, segZ, Math.min(oz, Z_MIN), Math.max(oz + oh, Z_MIN + HEIGHT_KM));
  const nx = xs.length;
  const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 3;
      pos[k] = xs[i];
      pos[k + 2] = zs[j];
    }
  }
  // Split like a PlaneGeometry (along the anti-diagonal), facing up.
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let t = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + nx;
      const c = b + 1;
      const d = a + 1;
      idx[t++] = a;
      idx[t++] = b;
      idx[t++] = d;
      idx[t++] = b;
      idx[t++] = c;
      idx[t++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  // The shader displaces vertices; give culling a box that contains the hills.
  g.boundingBox = new THREE.Box3(new THREE.Vector3(xs[0], -0.3, zs[0]), new THREE.Vector3(xs[nx - 1], 1.8, zs[nz - 1]));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
  return g;
}

export default function Terrain({
  tex,
  segments,
  cutout,
  outer,
}: {
  tex: AtlasTextures;
  segments: number;
  cutout: boolean;
  /** the country around the map: x, z, width, height (km) */
  outer?: [number, number, number, number];
}) {
  const bounds = tex.outer ? outer : undefined;
  const geometry = useMemo(() => baseGeometry(segments, bounds), [segments, bounds]);
  const material = useMemo(() => terrainMaterial(tex, false, 7.33, undefined, cutout, bounds), [tex, cutout, bounds]);

  return <mesh geometry={geometry} material={material} frustumCulled={false} receiveShadow />;
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
  return <mesh geometry={geometry} material={material} receiveShadow />;
}
