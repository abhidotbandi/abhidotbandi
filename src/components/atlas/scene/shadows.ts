import * as THREE from "three";
import { OCCLUSION_PARS, occlusion } from "./Occlusion";

// Sun shadows for the atlas's own shader materials, from the scene's directional light (its box
// fitted to the view each frame in AtlasCanvas's <Sun>). three's built-in materials (the
// landmarks, trees) take them natively; ours opt in with `lights: true`, the light uniforms and
// these chunks, and multiply their sunlight by sunShadow() and cloudShadow().

/** The clouds nearest the view, for their shadows (filled each frame by Clouds.tsx). */
export const CLOUD_SLOTS = 16;
export const cloudShadows = {
  /** per cloud: x, z (km), the altitude it shades from, and its half-length (0 = empty slot) */
  uCloudA: { value: new Float32Array(CLOUD_SLOTS * 4) },
  /** per cloud: its heading as (cos, -sin), its width over its length, and its shadow's strength */
  uCloudB: { value: new Float32Array(CLOUD_SLOTS * 4) },
};

/** The light uniforms three fills in when a material has `lights: true`; the clouds' and the
 * contact shadows' (shared). */
export const shadowUniforms = () => ({ ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights), ...cloudShadows, ...occlusion });

export const SHADOW_VERTEX_PARS = /* glsl */ `
  #include <shadowmap_pars_vertex>
`;

/** In main(), with the vertex's world position (km) in `world`. */
export const shadowVertex = (world: string) => /* glsl */ `
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    vDirectionalShadowCoord[ 0 ] = directionalShadowMatrix[ 0 ] * vec4( ${world}, 1.0 );
  #endif
`;

export const SHADOW_FRAGMENT_PARS = /* glsl */ `
  #ifndef PI2
    #define PI2 6.283185307179586
  #endif
  #include <shadowmap_pars_fragment>
  // How much sun reaches here: 1 in the open, down to 0 in shadow, soft-edged (PCF). Faces
  // turned from the sun get more bias (they're dark anyway), and the shadows fade out toward
  // the edge of the shadow map so its boundary never shows.
  float sunShadow( vec3 n, vec3 sunDir ) {
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
      vec4 sc = vDirectionalShadowCoord[ 0 ];
      vec2 uv = sc.xy / sc.w;
      float edge = smoothstep( 0.0, 0.07, min( min( uv.x, uv.y ), min( 1.0 - uv.x, 1.0 - uv.y ) ) );
      if ( edge <= 0.0 ) return 1.0;
      DirectionalLightShadow s = directionalLightShadows[ 0 ];
      float ndl = clamp( dot( n, sunDir ), 0.08, 1.0 );
      float bias = s.shadowBias * ( 1.0 + 2.5 * sqrt( 1.0 - ndl * ndl ) / ndl );
      float lit = getShadow( directionalShadowMap[ 0 ], s.shadowMapSize, s.shadowIntensity, bias, s.shadowRadius, sc );
      return mix( 1.0, lit, edge );
    #else
      return 1.0;
    #endif
  }
  // The clouds' shadows: soft ellipses where the line to the sun passes under a cloud.
  uniform vec4 uCloudA[ ${CLOUD_SLOTS} ];
  uniform vec4 uCloudB[ ${CLOUD_SLOTS} ];
  float cloudShadow( vec3 p, vec3 sunDir ) {
    if ( sunDir.y < 0.03 ) return 1.0;
    vec2 k = sunDir.xz / sunDir.y;
    float shade = 0.0;
    for ( int i = 0; i < ${CLOUD_SLOTS}; i++ ) {
      vec4 a = uCloudA[ i ];
      if ( a.w <= 0.0 ) continue;
      vec4 b = uCloudB[ i ];
      vec2 q = p.xz + k * ( a.z - p.y ) - a.xy;
      vec2 l = vec2( dot( q, b.xy ), dot( q, vec2( -b.y, b.x ) ) / b.z ) / a.w;
      shade = max( shade, ( 1.0 - smoothstep( 0.45, 1.0, length( l ) ) ) * b.w );
    }
    return 1.0 - shade;
  }
  ${OCCLUSION_PARS}
`;
