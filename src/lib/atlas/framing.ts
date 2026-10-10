import { clamp } from "./geo";

// How the camera frames a viewport (scene/CameraDirector.tsx), and where the tour's panels sit
// over it (app/atlas/atlas.css: the breakpoints here and there must agree).

/** Vertical field of view (degrees): wider on portrait screens, as map apps do, so a phone sees
 * about as much of the city across as a laptop, rather than a sliver of it. */
export function viewFov(width: number, height: number): number {
  const aspect = width / Math.max(1, height);
  return 32 + 16 * clamp((1 - aspect) / 0.55, 0, 1);
}

/** Wide enough for the tour's cards to sit beside the map rather than over it. */
export const isWide = (width: number) => width >= 900;

/** Wide enough for the chapter list down the left as well, with the cards beside it. */
export const hasChapterNav = (width: number) => width >= 1100;

/** How far below the middle of the screen the city sits under the title card (of its height). */
const TITLE_DROP = 0.17;

/**
 * Where the tour puts its focal point, in CSS pixels from the viewport's centre (x right, y up):
 * in the open map right of the story cards on wide screens (the cards left of it, after the
 * chapter list when there is one: max(280px, 16vw) to 410px past that), up into the open map
 * above them on phones. `title` (0..1) is how far the opening's title card is up, in the middle
 * of the screen: the city then sits below it.
 */
export function tourOffset(width: number, height: number, title = 0): { x: number; y: number } {
  const card = hasChapterNav(width)
    ? { x: (Math.max(280, width * 0.16) + 370) / 2, y: 0 }
    : isWide(width)
      ? { x: Math.min(250, width * 0.15), y: 0 }
      : { x: 0, y: height * 0.25 };
  const hero = { x: 0, y: -height * TITLE_DROP };
  return { x: card.x + (hero.x - card.x) * title, y: card.y + (hero.y - card.y) * title };
}
