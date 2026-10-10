import * as THREE from "three";
import { SITES, SITE_BY_ID, type SiteRef } from "@/data/atlas/companies";
import { DOMAINS } from "@/data/atlas/domains";
import { STOPS } from "@/data/atlas/tour";
import type { AtlasMode } from "@/lib/atlas/store";
import type { DomainId } from "@/data/atlas/domains";

/** The site table the building shaders index (uSite[]): room to grow past today's sites. */
export const MAX_SITES = 128;

/** Shared with the buildings shader: rgb = linear domain colour, a = emphasis (-1 = filtered out). */
export const siteUniforms = {
  uSite: { value: Array.from({ length: MAX_SITES }, () => new THREE.Vector4()) },
};

/** Per-site emphasis for beacons and labels, 0..1, or -1 when filtered out. */
export const siteEmphasis = new Float32Array(MAX_SITES);
/**
 * The same without hover. Beacon stems (and so the labels on them) take their height from this:
 * a stem growing under the pointer would carry its label out from under it, and the hover would
 * flicker on and off.
 */
export const siteRestEmphasis = new Float32Array(MAX_SITES);

const dayColors = SITES.map((s) => new THREE.Color(DOMAINS[s.company.domain].day));
const nightColors = SITES.map((s) => new THREE.Color(DOMAINS[s.company.domain].night));
const tmp = new THREE.Color();

export function siteColor(s: SiteRef, night: number, out = new THREE.Color()): THREE.Color {
  return out.copy(dayColors[s.index]).lerp(nightColors[s.index], night);
}

const stopSiteSets = STOPS.map((stop) => new Set(stop.sites));

export interface SiteStateInput {
  mode: AtlasMode;
  activeStop: number;
  selected: string | null;
  hovered: string | null;
  domains: Set<DomainId>;
  defenseOnly: boolean;
  night: number;
}

export function isSiteFiltered(s: SiteRef, domains: Set<DomainId>, defenseOnly: boolean): boolean {
  return !domains.has(s.company.domain) || (defenseOnly && !s.company.defense);
}

export function updateSiteState(inp: SiteStateInput) {
  const focus = stopSiteSets[inp.activeStop];
  const selectedCompany = inp.selected ? SITE_BY_ID.get(inp.selected)?.company.id : undefined;
  for (const s of SITES) {
    let rest: number;
    if (isSiteFiltered(s, inp.domains, inp.defenseOnly)) rest = -1;
    else if (s.id === inp.selected) rest = 1;
    else if (s.company.id === selectedCompany) rest = 0.85;
    else if (inp.mode === "tour") rest = focus?.has(s.id) ? 0.9 : 0.15;
    else rest = 0.55;
    const e = rest >= 0 && s.id === inp.hovered ? 1 : rest;
    siteRestEmphasis[s.index] = rest;
    siteEmphasis[s.index] = e;
    const c = siteColor(s, inp.night, tmp);
    siteUniforms.uSite.value[s.index].set(c.r, c.g, c.b, e);
  }
}
