import * as THREE from "three";

/**
 * A round glow for point sprites: a radial gradient through colour stops (t from the centre, 0..1;
 * r, g, b 0..255; a 0..1), as a canvas 2D gradient would draw it. Filled in directly: a 2D canvas
 * means starting the browser's 2D renderer, which is slow at the busiest moment of the load.
 */
export function radialTexture(size: number, stops: [number, number, number, number, number][]): THREE.DataTexture {
  const px = new Uint8Array(size * size * 4);
  const h = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = Math.min(1, Math.hypot(x + 0.5 - h, y + 0.5 - h) / h);
      let k = 1;
      while (k < stops.length - 1 && stops[k][0] < t) k++;
      const a = stops[k - 1];
      const b = stops[k];
      const f = b[0] > a[0] ? Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))) : 1;
      const i = (y * size + x) * 4;
      px[i] = a[1] + (b[1] - a[1]) * f;
      px[i + 1] = a[2] + (b[2] - a[2]) * f;
      px[i + 2] = a[3] + (b[3] - a[3]) * f;
      px[i + 3] = (a[4] + (b[4] - a[4]) * f) * 255;
    }
  }
  const tex = new THREE.DataTexture(px, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Draw a glow's points `km` nearer the camera than they are, along the line of sight, so they
 * stay where they are on screen. A point sprite has one depth for all of it, so without this
 * the ground just in front of a lamp cuts off the bottom of its glow.
 */
export function pullTowardCamera(material: THREE.PointsMaterial, km: number) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      `#include <project_vertex>
      mvPosition.xyz *= max(0.05, 1.0 - ${km.toFixed(4)} / length(mvPosition.xyz));
      gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  material.customProgramCacheKey = () => `pull${km}`;
}
