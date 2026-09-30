/**
 * Named points in the atlas's load (performance marks, "atlas:<name>"), so the time to the first
 * view can be measured and broken down: see scripts/atlas/README.md.
 */
export function mark(name: string) {
  if (typeof performance !== "undefined" && typeof performance.mark === "function") performance.mark(`atlas:${name}`);
}
