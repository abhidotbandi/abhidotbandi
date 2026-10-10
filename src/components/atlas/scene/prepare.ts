import * as THREE from "three";
import type { BufferGeometry } from "three";
import { SITES, SITE_BY_ID } from "@/data/atlas/companies";
import type { AtlasAssets } from "@/lib/atlas/assets";
import { buildingGeometry, type BuildingMesh } from "@/lib/atlas/buildings";
import type { BuildingsData } from "@/lib/atlas/buildingsCodec";
import type { Central, Trees } from "@/lib/atlas/central";
import { BaseMeshField, Ground, PatchGrid, RegionRaster } from "@/lib/atlas/geo";
import type { CentralPrep, RegionalPrep, WaterLevels } from "@/lib/atlas/prep/compute";
import { emptySiteModels, siteModelSet, type SiteModelArrays, type SiteModelSet } from "@/lib/atlas/siteModels";
import { makeTextures, type AtlasTextures } from "./textures";

// The scene's three.js objects, wrapped around what the prep worker computed (lib/atlas/prep):
// textures, geometries, and the ground everything stands on.

/** Central Austin's detail, once it has loaded. */
export interface CentralScene {
  data: Central;
  /** textures for the central Austin detail patch */
  tex: AtlasTextures;
  /** mesh-resolution heights of the central patch */
  patch: PatchGrid;
  buildings: BuildingMesh;
  /** the buildings 12 m and up, for the lakes' reflections, over `buildings`' vertices (desktop only) */
  skyline: BufferGeometry | null;
  /** the footprints behind `buildings`, which the detail tiles' trees keep clear of */
  footprints: BuildingsData;
  /** the patch's trees, clear of the site models' plant and the Capitol's walks and monuments */
  trees: Trees;
  /** the water's level across the patch, for the lake's reflections */
  water: WaterLevels;
}

export interface PreparedScene {
  assets: AtlasAssets;
  tex: AtlasTextures;
  /** street-scale central Austin; null until it loads */
  central: CentralScene | null;
  /** the ground everything stands on (the patch where there is one, else the base terrain) */
  ground: Ground;
  /** the surface the base terrain mesh draws, which the patch edge meets */
  baseSurface: BaseMeshField;
  buildings: BuildingMesh;
  /** the company sites, modelled (their plain extrusions are left out of `buildings`) */
  models: SiteModelSet;
  /** per SITES index: highest roof of the site's buildings in any set (world y), or NaN */
  siteTop: Float32Array;
  /** terrain grid resolution (segments across) */
  terrainSegments: number;
  lowPower: boolean;
}

/** Per-site highest roofs from two sets, either of which may lack a site (NaN). */
function maxTop(a: Float32Array, b: Float32Array): Float32Array {
  return a.map((v, i) => (Number.isNaN(v) ? b[i] : Number.isNaN(b[i]) ? v : Math.max(v, b[i])));
}

const SHARED = SITES.filter((s) => s.shares).map((s) => [s.index, SITE_BY_ID.get(s.shares!)?.index ?? -1] as const);

/** A co-tenant's beacon stands on the roof of the building it shares (tagged to the other site). */
function withCoTenants(top: Float32Array): Float32Array {
  for (const [i, j] of SHARED) if (j >= 0 && Number.isNaN(top[i])) top[i] = top[j];
  return top;
}

/** The regional map's scene. The site models come with central Austin (or withSiteModels). */
export function prepareScene(r: RegionalPrep): PreparedScene {
  // Class instances don't survive the trip from the worker: rebuild the raster around its data.
  const h = r.assets.height;
  const assets: AtlasAssets = { ...r.assets, height: new RegionRaster(h.width, h.height, h.data) };
  const baseSurface = new BaseMeshField(assets.height, r.terrainSegments);
  const buildings = { geometry: buildingGeometry(r.buildings), siteTop: r.buildings.siteTop };
  return {
    assets,
    tex: makeTextures(r.pixels),
    central: null,
    ground: new Ground(baseSurface, null),
    baseSurface,
    buildings,
    models: siteModelSet(emptySiteModels(SITES.length)),
    siteTop: withCoTenants(buildings.siteTop.slice()),
    terrainSegments: r.terrainSegments,
    lowPower: r.lowPower,
  };
}

/** Add central Austin to a prepared scene: its patch terrain, the ground on it, its buildings and the sites' models. */
export function upgradeScene(scene: PreparedScene, c: CentralPrep): PreparedScene {
  const patch = new PatchGrid(c.patch.nx, c.patch.nz, c.patch.data);
  const buildings = { geometry: buildingGeometry(c.buildings), siteTop: c.buildings.siteTop };
  const models = siteModelSet(c.models);
  return {
    ...scene,
    central: {
      data: c.central,
      tex: makeTextures(c.pixels),
      patch,
      buildings,
      skyline: c.skyline && subset(buildings.geometry, c.skyline),
      footprints: c.footprints,
      trees: c.trees,
      water: c.water,
    },
    ground: new Ground(scene.baseSurface, patch),
    models,
    siteTop: withCoTenants(maxTop(maxTop(scene.buildings.siteTop, models.siteTop), buildings.siteTop)),
  };
}

/** Some of a geometry's triangles, as a geometry sharing its vertices (uploaded once). */
function subset(g: BufferGeometry, index: Uint32Array): BufferGeometry {
  const s = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) s.setAttribute(name, attr);
  s.setIndex(new THREE.BufferAttribute(index, 1));
  s.boundingSphere = g.boundingSphere;
  return s;
}

/** The sites' models on the regional map alone, when central Austin's detail couldn't load. */
export function withSiteModels(scene: PreparedScene, m: SiteModelArrays): PreparedScene {
  const models = siteModelSet(m);
  return { ...scene, models, siteTop: withCoTenants(maxTop(scene.buildings.siteTop, models.siteTop)) };
}
