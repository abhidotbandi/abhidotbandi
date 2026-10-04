import raw from "./companies.json";
import type { DomainId } from "./domains";
import { project } from "@/lib/atlas/geo";

export interface Site {
  id: string;
  label: string;
  place: string;
  address: string;
  lat: number;
  lon: number;
  /** km; how far the pipeline looked for this site's own buildings */
  radius: number;
  /** a co-tenant's site whose building this one is in (the building is painted as that site's) */
  shares?: string;
}

export type CompanyStatus =
  | { kind: "private"; raised?: number; valuation?: number; lastRound?: string; asOf?: string }
  | { kind: "public"; ticker: string; exchange: string; note?: string }
  | { kind: "subsidiary"; parent: string }
  | { kind: "institution"; parent: string; est?: number };

export interface Company {
  id: string;
  name: string;
  domain: DomainId;
  builds: string;
  blurb: string;
  facts: string[];
  founded?: number;
  status: CompanyStatus;
  defense: boolean;
  tier: 1 | 2 | 3;
  url?: string;
  sites: Site[];
  sources: { label: string; url: string }[];
}

export interface SiteRef extends Site {
  company: Company;
  /** position in SITES; the building files tag footprints by site id, mapped to this */
  index: number;
  /** first site listed for the company */
  primary: boolean;
  x: number;
  z: number;
}

export const COMPANIES = raw as Company[];

export const SITES: SiteRef[] = COMPANIES.flatMap((company) =>
  company.sites.map((site, i) => {
    const [x, z] = project(site.lon, site.lat);
    return { ...site, company, primary: i === 0, x, z, index: 0 };
  }),
).map((s, index) => ({ ...s, index }));

export const SITE_BY_ID = new Map(SITES.map((s) => [s.id, s]));
export const COMPANY_BY_ID = new Map(COMPANIES.map((c) => [c.id, c]));

export function isInstitution(c: Company): boolean {
  return c.status.kind === "institution";
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

export function formatUsd(n: number): string {
  if (n >= 1e9) return `$${trimZeros((n / 1e9).toFixed(2))}B`;
  if (n >= 1e6) return `$${Math.round(n / 1e6)}M`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * The figure a map label carries beside the name, from the company's sourced status: its
 * last valuation, else what it has raised, or its ticker. Undefined when there's nothing to say.
 */
export function labelFigure(c: Company): { text: string; kind: "money" | "ticker" } | undefined {
  const s = c.status;
  if (s.kind === "public") return { text: s.ticker, kind: "ticker" };
  if (s.kind !== "private") return undefined;
  if (s.valuation) return { text: formatUsd(s.valuation), kind: "money" };
  if (s.raised) return { text: `${formatUsd(s.raised)} raised`, kind: "money" };
  return undefined;
}

/** Short status line for chips and table cells. */
export function statusLine(c: Company): string {
  const s = c.status;
  switch (s.kind) {
    case "public":
      return `${s.exchange}: ${s.ticker}`;
    case "subsidiary":
      return `Part of ${s.parent}`;
    case "institution":
      return s.parent;
    case "private":
      if (s.valuation) return `${formatUsd(s.valuation)} valuation`;
      if (s.raised) return `${formatUsd(s.raised)} raised`;
      return s.lastRound ?? "Private";
  }
}
