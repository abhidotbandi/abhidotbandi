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

/** Models for the company sites, on their footprints in the building files given. */
export function buildSiteModels(sources: BuildingsData[], ground: HeightField, siteCount: number): SiteModelSet {
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
  let geometry: THREE.BufferGeometry | null = null;
  if (kit.pos.length) {
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(kit.pos, 3));
    geometry.setAttribute("aColor", new THREE.Float32BufferAttribute(kit.col, 3));
    geometry.setAttribute("aKind", new THREE.Float32BufferAttribute(kit.kind, 2));
    geometry.computeBoundingSphere();
  }
  return { geometry, siteTop, steam: new Float32Array(steam), engine, clearings: asFootprints(kit.clear) };
}
