import { PORTRAIT_POSTER_MEDIA, POSTERS, type Poster } from "@/data/atlas/poster";
import { clamp } from "./geo";
import { POSTER_THUMBS } from "@/data/atlas/posterThumbs";

// How the camera frames a viewport, shared by the camera (scene/CameraDirector.tsx) and the
// opening shot's poster image, which has to line up with it exactly.

/** Vertical field of view (degrees): wider on portrait screens, as map apps do, so a phone sees
 * about as much of the city across as a laptop, rather than a sliver of it. */
export function viewFov(width: number, height: number): number {
  const aspect = width / Math.max(1, height);
  return 32 + 16 * clamp((1 - aspect) / 0.55, 0, 1);
}

/** Wide enough for the tour's cards to sit beside the map rather than over it. */
export const isWide = (width: number) => width >= 900;

/**
 * Where the tour puts its focal point, in CSS pixels from the viewport's centre (x right, y up):
 * right of the story cards on wide screens, up into the open map above them on phones.
 */
export function tourOffset(width: number, height: number): { x: number; y: number } {
  return isWide(width) ? { x: Math.min(250, width * 0.15), y: 0 } : { x: 0, y: height * 0.25 };
}

const tanHalf = (fovDeg: number) => Math.tan((fovDeg * Math.PI) / 360);

/**
 * Where a poster goes (CSS px) to line up with the live map on a W x H screen: the camera is in
 * the same place, so the two differ only by a scale (field of view) and a shift (focal point).
 * `exact` is false when the poster, so placed, wouldn't cover the screen: it is then scaled to
 * cover it instead, and the fade to the live map shifts a little.
 */
export function posterPlacement(p: Poster, width: number, height: number) {
  const s = (height / 2 / tanHalf(viewFov(width, height))) / (p.height / 2 / tanHalf(p.fov));
  const off = tourOffset(width, height);
  const cx = width / 2 + off.x;
  const cy = height / 2 - off.y;
  let r = { left: cx - s * p.ppx, top: cy - s * p.ppy, width: s * p.width, height: s * p.height, exact: true };
  if (r.left > 0.5 || r.top > 0.5 || r.left + r.width < width - 0.5 || r.top + r.height < height - 0.5) {
    const k = Math.max(width / p.width, height / p.height);
    r = { left: (width - k * p.width) / 2, top: (height - k * p.height) / 2, width: k * p.width, height: k * p.height, exact: false };
  }
  return r;
}

/**
 * The same placement in CSS, for before the page's scripts run: exact on landscape screens (the
 * field of view there is fixed, and the focal point's shift is expressible in CSS), close on
 * phones (it assumes a typical phone's field of view). Under each poster, its tiny inlined copy
 * (unquoted: base64 needs no quoting in url()) shows the city blurred until the poster loads.
 */
export function posterCss(): string {
  const L = POSTERS.landscape;
  const P = POSTERS.portrait;
  // Landscape: scale = 100vh / L.height (same field of view).
  const lx = ((L.ppx / L.height) * 100).toFixed(4);
  // Portrait: a 390 x 844 phone's field of view.
  const s = 1 / 2 / tanHalf(viewFov(390, 844)) / (P.height / 2 / tanHalf(P.fov)); // per px of screen height
  const v = (n: number) => `${(n * s * 100).toFixed(4)}vh`;
  return [
    `.atlas-poster i{top:0;height:100vh;width:${((L.width / L.height) * 100).toFixed(4)}vh;left:calc(50vw + min(250px, 15vw) - ${lx}vh);background-image:url(${L.src}),url(${POSTER_THUMBS.landscape})}`,
    `@media ${PORTRAIT_POSTER_MEDIA}{.atlas-poster i{height:${v(P.height)};width:${v(P.width)};left:calc(50vw - ${v(P.ppx)});top:calc(25vh - ${v(P.ppy)});background-image:url(${P.src}),url(${POSTER_THUMBS.portrait})}}`,
  ].join("");
}
