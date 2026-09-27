"use client";

import { useMemo, useState } from "react";
import { SITES, type SiteRef } from "@/data/atlas/companies";
import { DOMAINS } from "@/data/atlas/domains";
import { PLACES, type PlaceRef } from "@/data/atlas/places";
import { useAtlas } from "@/lib/atlas/store";
import { DomainGlyph } from "./glyphs";
import { IconPin, IconSearch } from "./icons";

const index = SITES.map((s) => ({
  site: s,
  hay: [s.company.name, s.company.builds, DOMAINS[s.company.domain].label, s.place, s.address, s.label]
    .join(" ")
    .toLowerCase(),
}));

const placeIndex = PLACES.map((p) => ({
  place: p,
  hay: [p.name, p.kind, p.label ?? "", p.blurb].join(" ").toLowerCase(),
}));

type Result = { kind: "site"; id: string; site: SiteRef } | { kind: "place"; id: string; place: PlaceRef };

interface Props {
  onPick: (siteId: string) => void;
  onPickPlace: (placeId: string) => void;
}

export default function SearchPalette(props: Props) {
  const open = useAtlas((s) => s.searchOpen);
  // Mounting per open gives a fresh query each time.
  return open ? <Palette {...props} /> : null;
}

function Palette({ onPick, onPickPlace }: Props) {
  const setOpen = useAtlas((s) => s.setSearchOpen);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);

  const results = useMemo((): Result[] => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = terms.length ? index.filter((r) => terms.every((t) => r.hay.includes(t))) : index;
    const sites: Result[] = list
      .map((r) => r.site)
      .sort((a, b) => {
        const qa = q && a.company.name.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1;
        const qb = q && b.company.name.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1;
        return qa - qb || a.company.tier - b.company.tier || a.company.name.localeCompare(b.company.name);
      })
      .map((site) => ({ kind: "site", id: site.id, site }));
    // Places: matches by name come first; with no query, a few to discover.
    const places: Result[] = (terms.length ? placeIndex.filter((r) => terms.every((t) => r.hay.includes(t))) : placeIndex.slice(0, 4))
      .map((r) => r.place)
      .sort((a, b) => {
        const qa = q && a.name.toLowerCase().includes(q.toLowerCase()) ? 0 : 1;
        const qb = q && b.name.toLowerCase().includes(q.toLowerCase()) ? 0 : 1;
        return qa - qb;
      })
      .map((place) => ({ kind: "place", id: place.id, place }));
    if (!terms.length) return [...sites.slice(0, 8), ...places];
    const named = places.filter((r) => r.kind === "place" && r.place.name.toLowerCase().includes(q.toLowerCase()));
    return [...named, ...sites, ...places.filter((r) => !named.includes(r))].slice(0, 12);
  }, [q]);

  const pick = (r: Result) => {
    setOpen(false);
    if (r.kind === "site") onPick(r.id);
    else onPickPlace(r.id);
  };

  return (
    <div className="modal-scrim" onClick={() => setOpen(false)}>
      <div
        className="search-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search companies"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sp-input">
          <IconSearch />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter" && results[sel]) {
                pick(results[sel]);
              }
            }}
            placeholder="Search companies, what they build, landmarks or places"
            aria-label="Search"
            aria-controls="sp-results"
            aria-activedescendant={results[sel] ? `sp-${results[sel].id}` : undefined}
          />
          <kbd>esc</kbd>
        </div>
        <ul id="sp-results" className="sp-results" role="listbox">
          {results.map((r, i) => (
            <li key={`${r.kind}-${r.id}`} id={`sp-${r.id}`} role="option" aria-selected={i === sel}>
              <button type="button" onClick={() => pick(r)} onMouseEnter={() => setSel(i)}>
                {r.kind === "site" ? (
                  <>
                    <DomainGlyph domain={r.site.company.domain} />
                    <span className="sp-name">
                      {r.site.company.name}
                      {!r.site.primary && <span className="sp-sub"> · {r.site.label}</span>}
                    </span>
                    <span className="sp-builds">{r.site.company.builds}</span>
                    <span className="sp-place">{r.site.place}</span>
                  </>
                ) : (
                  <>
                    <IconPin />
                    <span className="sp-name">{r.place.name}</span>
                    <span className="sp-builds">{r.place.blurb}</span>
                    <span className="sp-place">{r.place.kind}</span>
                  </>
                )}
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="sp-empty">No matches. Try “reactor”, “Barton Springs” or “chips”.</li>}
        </ul>
      </div>
    </div>
  );
}
