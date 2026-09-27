import { SITES, SITE_BY_ID } from "@/data/atlas/companies";
import type { AtlasAssets, CentralAssets } from "@/lib/atlas/assets";
import { buildBuildings, type BuildingMesh } from "@/lib/atlas/buildings";
import { pointInPoly } from "@/lib/atlas/polygon";
import { MODELLED_LANDMARKS, buildPatchGrid, type Central } from "@/lib/atlas/central";
import { BaseMeshField, Ground, type PatchGrid } from "@/lib/atlas/geo";
import { makeCentralTextures, makeTextures, type AtlasTextures } from "./textures";

/** Central Austin's detail, once it has loaded. */
export interface CentralScene {
  data: Central;
  /** textures for the central Austin detail patch */
  tex: AtlasTextures;
  /** mesh-resolution heights of the central patch */
  patch: PatchGrid;
  buildings: BuildingMesh;
}

export interface PreparedScene {
  assets: AtlasAssets;
  tex: AtlasTextures;
  /** street-scale central Austin; null until it loads (the regional map draws first) */
  central: CentralScene | null;
  /** the ground everything stands on (the patch where there is one, else the base terrain) */
  ground: Ground;
  /** the surface the base terrain mesh draws, which the patch edge meets */
  baseSurface: BaseMeshField;
  buildings: BuildingMesh;
  /** per SITES index: highest roof of the site's buildings in either set (world y), or NaN */
  siteTop: Float32Array;
  /** terrain grid resolution (segments across) */
  terrainSegments: number;
  lowPower: boolean;
}

const siteIndex = (id: string) => SITE_BY_ID.get(id)?.index ?? -1;

/** CPU-side prep of the regional map, run once while the loader is still up. */
export function prepareScene(assets: AtlasAssets): PreparedScene {
  const lowPower =
    typeof window !== "undefined" &&
    (window.matchMedia("(pointer: coarse)").matches || (navigator.hardwareConcurrency ?? 8) <= 4);
  const tex = makeTextures(assets);
  const terrainSegments = lowPower ? 320 : 560;
  // Objects and the patch edge follow the surface the base mesh draws, not the raster.
  const baseSurface = new BaseMeshField(assets.height, terrainSegments);
  const ground = new Ground(baseSurface, null);
  const buildings = buildBuildings(assets.buildings, ground, siteIndex, SITES.length, lowPower ? 120 : 0);
  return {
    assets,
    tex,
    central: null,
    ground,
    baseSurface,
    buildings,
    siteTop: buildings.siteTop,
    terrainSegments,
    lowPower,
  };
}

/** Add central Austin to a prepared scene: its patch terrain, the ground on it, and its buildings. */
export function upgradeScene(scene: PreparedScene, c: CentralAssets): PreparedScene {
  const { lowPower, buildings } = scene;
  // ~16 m mesh cells on desktop (the DEM is ~8 m), ~28 m on phones.
  const patch = buildPatchGrid(c.central, scene.baseSurface, lowPower ? 0.028 : 0.016);
  const ground = new Ground(scene.baseSurface, patch);
  // The Capitol, the Tower and the other modelled landmarks: drop their plain extrusions.
  const modelled = MODELLED_LANDMARKS.flatMap((k) => c.central.landmarks[k]?.outline ?? []);
  const central = buildBuildings(c.buildings, ground, siteIndex, SITES.length, lowPower ? 120 : 0, (x, z) =>
    modelled.some((o) => pointInPoly(o, x, z)),
  );
  const siteTop = buildings.siteTop.map((v, i) => {
    const t = central.siteTop[i];
    return Number.isNaN(v) ? t : Number.isNaN(t) ? v : Math.max(v, t);
  });
  return {
    ...scene,
    central: { data: c.central, tex: makeCentralTextures(c.central), patch, buildings: central },
    ground,
    siteTop,
  };
}
