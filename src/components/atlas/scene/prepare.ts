import { SITES, SITE_BY_ID } from "@/data/atlas/companies";
import type { AtlasAssets } from "@/lib/atlas/assets";
import { buildBuildings, type BuildingMesh } from "@/lib/atlas/buildings";
import { makeTextures, type AtlasTextures } from "./textures";

export interface PreparedScene {
  assets: AtlasAssets;
  tex: AtlasTextures;
  buildings: BuildingMesh;
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
  const buildings = buildBuildings(
    assets.buildings,
    assets.height,
    (id) => SITE_BY_ID.get(id)?.index ?? -1,
    SITES.length,
    lowPower ? 120 : 0,
  );
  return { assets, tex, buildings, terrainSegments: lowPower ? 320 : 560, lowPower };
}
