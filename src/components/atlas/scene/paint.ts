import * as THREE from "three";
import { HEIGHT_KM, WIDTH_KM, X_MIN, Z_MIN } from "@/lib/atlas/geo";
import { sky } from "@/lib/atlas/timeOfDay";
import { SHADOW_FRAGMENT_PARS, shadowUniforms } from "./shadows";

// Paint on the ground (the detail tiles' streets, lots and pools; the airport's runways): flat
// shapes lifted a hair over the terrain, lit as the ground beneath them is.

export const LIT = /* glsl */ `
  ${SHADOW_FRAGMENT_PARS}
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uAmbient;
  uniform float uNight;
  uniform sampler2D uNormal;
  uniform vec4 uRegion;
  uniform float uFade;
  uniform float uAppear;
  vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
  // Lit like the ground beneath, so paint and paving sit in the terrain's light.
  vec3 groundLit(vec3 col, vec3 world) {
    vec3 n = normalize(texture2D(uNormal, (world.xz - uRegion.xy) / uRegion.zw).xyz * 2.0 - 1.0);
    float diff = max(dot(n, uSunDir), 0.0) * sunShadow(n, uSunDir) * cloudShadow(world, uSunDir);
    float open = skyOpen(world, n);
    return col * (uAmbient * (0.6 + 0.4 * n.y) * 0.78 * open + uSunColor * diff * 0.52 * mix(1.0, open, 0.35)) * (1.0 - uNight * 0.82);
  }
`;

/** Uniforms a set of paint materials shares (uFade, uLift and uPxK are set each frame). */
export function sharedUniforms(normal: THREE.Texture) {
  return {
    uSunColor: sky.uSunColor,
    uSunDir: sky.uSunDir,
    uAmbient: sky.uAmbient,
    uNight: sky.uNight,
    uTime: sky.uTime,
    uNormal: { value: normal },
    uRegion: { value: new THREE.Vector4(X_MIN, Z_MIN, WIDTH_KM, HEIGHT_KM) },
    uFade: { value: 0 },
    uLift: { value: 0.001 },
    uPxK: { value: 0.001 },
  };
}

export type SharedPaint = ReturnType<typeof sharedUniforms>;

/** The frame's lift (km, more from further away, so the paint never fights the terrain) and
 * world size of a device pixel per km of depth. */
export function updatePaint(sh: SharedPaint, camera: THREE.PerspectiveCamera, dist: number, height: number, dpr: number) {
  sh.uFade.value = 1;
  sh.uLift.value = 0.0008 + 0.00012 * dist;
  sh.uPxK.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, height * dpr);
}

/** Paint is seen from above only, but drawn from both sides: the tiles' polygons come out of the
 * triangulator facing down, and were culled. */
export function paintMaterial(shared: SharedPaint, appear: { value: number }, vertexShader: string, fragmentShader: string) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    lights: true,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...shadowUniforms(), ...shared, uAppear: appear },
  });
}
