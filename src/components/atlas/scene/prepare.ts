import { SITES, SITE_BY_ID } from "@/data/atlas/companies";
import type { AtlasAssets } from "@/lib/atlas/assets";
import { buildBuildings, type BuildingMesh } from "@/lib/atlas/buildings";
import { pointInPoly } from "@/lib/atlas/polygon";
import { MODELLED_LANDMARKS, buildPatchGrid } from "@/lib/atlas/central";
import { BaseMeshField, Ground, type PatchGrid } from "@/lib/atlas/geo";
import { makeCentralTextures, makeTextures, type AtlasTextures } from "./textures";

export interface PreparedScene {
  assets: AtlasAssets;
  tex: AtlasTextures;
  /** textures for the central Austin detail patch */
  centralTex: AtlasTextures;
  /** mesh-resolution heights of the central patch */
  patch: PatchGrid;
  /** the ground everything stands on (patch where there is one, else the base terrain) */
  ground: Ground;
  buildings: BuildingMesh;
  centralBuildings: BuildingMesh;
  /** per SITES index: highest roof of the site's buildings in either set (world y), or NaN */
  siteTop: Float32Array;
  /** terrain grid resolution (segments across) */
  terrainSegments: number;
  lowPower: boolean;
}

/** CPU-side scene prep, run once while the loader is still up. */
export function prepareScene(assets: AtlasAssets): PreparedScene {
  const lowPower =
    typeof window !== "undefined" &&
    (window.matchMedia("(pointer: coarse)").matches || (navigator.hardwareConcurrency ?? 8) <= 4);
  const tex = makeTextures(assets);
  const centralTex = makeCentralTextures(assets.central);
  const terrainSegments = lowPower ? 320 : 560;
  // Objects and the patch edge follow the surface the base mesh draws, not the raster.
  const baseSurface = new BaseMeshField(assets.height, terrainSegments);
  // ~16 m mesh cells on desktop (the DEM is ~8 m), ~28 m on phones.
  const patch = buildPatchGrid(assets.central, baseSurface, lowPower ? 0.028 : 0.016);
  const ground = new Ground(baseSurface, patch);
  const siteIndex = (id: string) => SITE_BY_ID.get(id)?.index ?? -1;
  const minArea = lowPower ? 120 : 0;
  const buildings = buildBuildings(assets.buildings, ground, siteIndex, SITES.length, minArea);
  // The Capitol and the UT Tower are modelled in Landmarks; drop their plain extrusions.
  const modelled = MODELLED_LANDMARKS.flatMap((k) => assets.central.landmarks[k]?.outline ?? []);
  const centralBuildings = buildBuildings(assets.centralBuildings, ground, siteIndex, SITES.length, minArea, (x, z) =>
    modelled.some((o) => pointInPoly(o, x, z)),
  );
  const siteTop = buildings.siteTop.map((v, i) => {
    const c = centralBuildings.siteTop[i];
    return Number.isNaN(v) ? c : Number.isNaN(c) ? v : Math.max(v, c);
  });
  return {
    assets,
    tex,
    centralTex,
    patch,
    ground,
    buildings,
    centralBuildings,
    siteTop,
    terrainSegments,
    lowPower,
  };
}
