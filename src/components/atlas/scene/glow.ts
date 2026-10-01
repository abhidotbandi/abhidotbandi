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
