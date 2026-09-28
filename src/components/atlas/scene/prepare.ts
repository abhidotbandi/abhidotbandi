import { SITES, SITE_BY_ID } from "@/data/atlas/companies";
import type { AtlasAssets, CentralAssets } from "@/lib/atlas/assets";
import { buildBuildings, type BuildingMesh } from "@/lib/atlas/buildings";
import { campusStyle } from "@/lib/atlas/campusStyle";
import type { BuildingsData } from "@/lib/atlas/buildingsCodec";
import { pointInPoly } from "@/lib/atlas/polygon";
import { MODELLED_LANDMARKS, buildPatchGrid, type Central } from "@/lib/atlas/central";
import { BaseMeshField, Ground, type PatchGrid } from "@/lib/atlas/geo";
import { MODELLED_SITES, buildSiteModels, type SiteModelSet } from "@/lib/atlas/siteModels";
import { isLowPower } from "@/lib/atlas/tier";
import { makeCentralTextures, makeTextures, type AtlasTextures } from "./textures";

/** Central Austin's detail, once it has loaded. */
export interface CentralScene {
  data: Central;
  /** textures for the central Austin detail patch */
  tex: AtlasTextures;
  /** mesh-resolution heights of the central patch */
  patch: PatchGrid;
  buildings: BuildingMesh;
  /** the footprints behind `buildings`, which the detail tiles' trees keep clear of */
  footprints: BuildingsData;
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
  /** the signature sites, modelled (their plain extrusions are left out of `buildings`) */
  models: SiteModelSet;
  /** per SITES index: highest roof of the site's buildings in any set (world y), or NaN */
  siteTop: Float32Array;
  /** terrain grid resolution (segments across) */
  terrainSegments: number;
  lowPower: boolean;
}

const siteIndex = (id: string) => SITE_BY_ID.get(id)?.index ?? -1;

/** Per-site highest roofs from two sets, either of which may lack a site (NaN). */
function maxTop(a: Float32Array, b: Float32Array): Float32Array {
  return a.map((v, i) => (Number.isNaN(v) ? b[i] : Number.isNaN(b[i]) ? v : Math.max(v, b[i])));
}

/** CPU-side prep of the regional map, run once while the loader is still up. */
export function prepareScene(assets: AtlasAssets): PreparedScene {
  const lowPower = isLowPower();
  const tex = makeTextures(assets);
  const terrainSegments = lowPower ? 320 : 560;
  // Objects and the patch edge follow the surface the base mesh draws, not the raster.
  const baseSurface = new BaseMeshField(assets.height, terrainSegments);
  const ground = new Ground(baseSurface, null);
  const modelled = new Set(MODELLED_SITES.map(siteIndex));
  const buildings = buildBuildings(assets.buildings, ground, siteIndex, SITES.length, lowPower ? 120 : 0, (_x, _z, site) =>
    modelled.has(site),
  );
  const models = buildSiteModels([assets.buildings], ground, SITES.length);
  return {
    assets,
    tex,
    central: null,
    ground,
    baseSurface,
    buildings,
    models,
    siteTop: maxTop(buildings.siteTop, models.siteTop),
    terrainSegments,
    lowPower,
  };
}

/** Add central Austin to a prepared scene: its patch terrain, the ground on it, and its buildings. */
export function upgradeScene(scene: PreparedScene, c: CentralAssets): PreparedScene {
  const { lowPower } = scene;
  // ~16 m mesh cells on desktop (the DEM is ~8 m), ~28 m on phones.
  const patch = buildPatchGrid(c.central, scene.baseSurface, lowPower ? 0.028 : 0.016);
  const ground = new Ground(scene.baseSurface, patch);
  // The Capitol, the Tower and the other modelled landmarks drop their plain extrusions, as do
  // the company sites modelled in their place.
  const landmarks = MODELLED_LANDMARKS.flatMap((k) => c.central.landmarks[k]?.outline ?? []);
  const sites = new Set(MODELLED_SITES.map(siteIndex));
  const central = buildBuildings(
    c.buildings,
    ground,
    siteIndex,
    SITES.length,
    lowPower ? 120 : 0,
    (x, z, site) => sites.has(site) || landmarks.some((o) => pointInPoly(o, x, z)),
    campusStyle,
  );
  // The site models again, now with central Austin's footprints too.
  const models = buildSiteModels([scene.assets.buildings, c.buildings], ground, SITES.length);
  const siteTop = maxTop(maxTop(scene.buildings.siteTop, models.siteTop), central.siteTop);
  return {
    ...scene,
    central: { data: c.central, tex: makeCentralTextures(c.central), patch, buildings: central, footprints: c.buildings },
    ground,
    models,
    siteTop,
  };
}
