/**
 * The opening shot as images, shown the moment the page loads while the live map gets ready
 * (rendered by scripts/atlas/render_poster.py; re-render them when the look of the opening view
 * changes). Each is the tour's first view as the camera frames it, with its own field of view
 * (degrees, vertical) and focal point (px), so it can be scaled and shifted to line up exactly
 * with the live map on any screen before the map fades in over it.
 */
export const POSTERS = {
  landscape: { src: "/atlas/poster.webp", width: 2400, height: 1200, fov: 32, ppx: 1450, ppy: 600 },
  portrait: { src: "/atlas/poster-portrait.webp", width: 1000, height: 1830, fov: 56, ppx: 500, ppy: 457.5 },
};

export type Poster = (typeof POSTERS)[keyof typeof POSTERS];

/** Screens that get the portrait poster; the rest get the landscape one. */
export const PORTRAIT_POSTER_MEDIA = "(max-aspect-ratio: 1/1), (max-width: 899px)";
