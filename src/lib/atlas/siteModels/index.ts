import * as THREE from "three";
import { SITE_BY_ID } from "@/data/atlas/companies";
import type { BuildingsData } from "../buildingsCodec";
import type { HeightField } from "../geo";
import { PLANS, buildPlanned } from "./archetypes";
import { Kit, siteFootprints } from "./kit";
import { FABS, boringCompany, fab, gigaTexas, rocketRanch, starlink } from "./signature";

// Every company site as a model instead of a plain extrusion in its domain colour (see
// signature.ts and archetypes.ts). The buildings stand on their mapped footprints. The plant and
// props around them go where the map has no building or street (each spot was checked against
// every footprint and street nearby), and the detail tiles keep their trees off them.

export { GLOW } from "./kit";

/** The sites modelled on their own (signature.ts); the rest go by their plans (archetypes.ts). */
const SIGNATURE = ["tesla", "samsung", "samsung-taylor", "nxp-oak-hill", "nxp-ed-bluestein", "firefly-ranch", "spacex", "boring-company"];

export const MODELLED_SITES = [...SIGNATURE, ...Object.keys(PLANS)];

export interface SiteModelSet {
  /** positions, aColor (linear), aKind (SITES index, GLOW) */
  geometry: THREE.BufferGeometry | null;
  /** per SITES index: highest point of the site's model (world y), or NaN */
  siteTop: Float32Array;
  /** cooling towers' outlets (world, km, xyz), for their steam */
  steam: Float32Array;
  /** the Rocket Ranch's engine stand: its nozzle exit */
  engine: THREE.Vector3 | null;
  /** ground under the plant, as footprints the detail tiles keep their trees off */
  clearings: BuildingsData;
}

function asFootprints(rings: number[][]): BuildingsData {
  const count = rings.length;
  const ringStart = new Uint32Array(count + 1);
  const vertStart = new Uint32Array(count + 1);
  const n = rings.reduce((s, r) => s + r.length / 2, 0);
  const x = new Int32Array(n);
  const z = new Int32Array(n);
  let v = 0;
  rings.forEach((r, i) => {
    ringStart[i + 1] = i + 1;
    vertStart[i] = v;
    for (let j = 0; j < r.length; j += 2) {
      x[v] = Math.round(r[j] * 1000);
      z[v++] = Math.round(r[j + 1] * 1000);
    }
  });
  vertStart[count] = v;
  return { sites: [], count, height: new Uint16Array(count), site: new Int16Array(count).fill(-1), ringStart, vertStart, x, z };
}

/** A site model set as plain arrays, built off the main thread (see prep/worker.ts). */
export interface SiteModelArrays {
  position: Float32Array;
  color: Float32Array;
  kind: Float32Array;
  siteTop: Float32Array;
  steam: Float32Array;
  engine: [number, number, number] | null;
  clearings: BuildingsData;
}

/** Models for the company sites, on their footprints in the building files given. */
export function buildSiteModelArrays(sources: BuildingsData[], ground: HeightField, siteCount: number): SiteModelArrays {
  const kit = new Kit();
  const steam: number[] = [];
  let engine: THREE.Vector3 | null = null;
  for (const id of MODELLED_SITES) {
    const s = SITE_BY_ID.get(id);
    const fps = sources.flatMap((d) => siteFootprints(d, id, ground)).sort((p, q) => q.areaM2 - p.areaM2);
    if (!s || !fps.length) continue;
    kit.site = s.index;
    if (id === "tesla") gigaTexas(kit, fps);
    else if (id === "spacex") starlink(kit, fps);
    else if (id === "firefly-ranch") engine = rocketRanch(kit, fps, s, ground);
    else if (id === "boring-company") boringCompany(kit, fps, s, ground);
    else if (FABS[id]) fab(kit, fps, s, FABS[id], ground, steam);
    else buildPlanned(kit, id, s, fps, ground, steam);
  }
  const siteTop = new Float32Array(siteCount).fill(Number.NaN);
  for (const [i, y] of kit.top) siteTop[i] = y;
  return {
    position: new Float32Array(kit.pos),
    color: new Float32Array(kit.col),
    kind: new Float32Array(kit.kind),
    siteTop,
    steam: new Float32Array(steam),
    engine: engine ? [engine.x, engine.y, engine.z] : null,
    clearings: asFootprints(kit.clear),
  };
}

/** No models yet (the regional map before central Austin's detail is in). */
export function emptySiteModels(siteCount: number): SiteModelArrays {
  return {
    position: new Float32Array(0),
    color: new Float32Array(0),
    kind: new Float32Array(0),
    siteTop: new Float32Array(siteCount).fill(Number.NaN),
    steam: new Float32Array(0),
    engine: null,
    clearings: asFootprints([]),
  };
}

/** The set as the scene uses it: one geometry, and the engine's nozzle as a vector. */
export function siteModelSet(a: SiteModelArrays): SiteModelSet {
  let geometry: THREE.BufferGeometry | null = null;
  if (a.position.length) {
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(a.position, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(a.color, 3));
    geometry.setAttribute("aKind", new THREE.BufferAttribute(a.kind, 2));
    geometry.computeBoundingSphere();
  }
  return {
    geometry,
    siteTop: a.siteTop,
    steam: a.steam,
    engine: a.engine ? new THREE.Vector3(...a.engine) : null,
    clearings: a.clearings,
  };
}
