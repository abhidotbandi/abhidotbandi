/**
 * The files the atlas needs for its first view, by device tier: the regional map and central
 * Austin's street-scale detail. Low-power devices (tier.ts) get the rasters at half resolution
 * (built by scripts/atlas/build_lowres.py), matching their coarser meshes. The page's early
 * script (app/atlas/layout.tsx) preloads the same files.
 */
export function atlasFiles(lowPower: boolean) {
  const lo = lowPower ? "_lo" : "";
  return {
    regional: {
      meta: "meta.json",
      terrain: `terrain${lo}.webp`,
      surface: `surface${lo}.webp`,
      vectors: "vectors.json",
      buildings: "buildings.bin",
      outer: `outer${lo}.webp`,
    },
    central: {
      terrain: `central_terrain${lo}.webp`,
      surface: `central_surface${lo}.webp`,
      data: "central.json",
      trees: "central_trees.bin",
      buildings: "central_buildings.bin",
    },
  };
}

/** Every first-view file for a tier, for preloading. */
export function firstViewFiles(lowPower: boolean): string[] {
  const f = atlasFiles(lowPower);
  return [...Object.values(f.regional), ...Object.values(f.central)];
}
