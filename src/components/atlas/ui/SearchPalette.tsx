"use client";

import { useMemo, useState } from "react";
import { SITES } from "@/data/atlas/companies";
import { DOMAINS } from "@/data/atlas/domains";
import { useAtlas } from "@/lib/atlas/store";
import { DomainGlyph } from "./glyphs";
import { IconSearch } from "./icons";

const index = SITES.map((s) => ({
  site: s,
  hay: [s.company.name, s.company.builds, DOMAINS[s.company.domain].label, s.place, s.address, s.label]
    .join(" ")
    .toLowerCase(),
}));

export default function SearchPalette({ onPick }: { onPick: (siteId: string) => void }) {
  const open = useAtlas((s) => s.searchOpen);
  // Mounting per open gives a fresh query each time.
  return open ? <Palette onPick={onPick} /> : null;
}

function Palette({ onPick }: { onPick: (siteId: string) => void }) {
  const setOpen = useAtlas((s) => s.setSearchOpen);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);

  const results = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = terms.length ? index.filter((r) => terms.every((t) => r.hay.includes(t))) : index;
    return list
      .map((r) => r.site)
      .sort((a, b) => {
        const qa = q && a.company.name.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1;
        const qb = q && b.company.name.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1;
        return qa - qb || a.company.tier - b.company.tier || a.company.name.localeCompare(b.company.name);
      })
      .slice(0, 12);
  }, [q]);

  const pick = (id: string) => {
    setOpen(false);
    onPick(id);
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
                pick(results[sel].id);
              }
            }}
            placeholder="Search companies, what they build, or places"
            aria-label="Search"
            aria-controls="sp-results"
            aria-activedescendant={results[sel] ? `sp-${results[sel].id}` : undefined}
          />
          <kbd>esc</kbd>
        </div>
        <ul id="sp-results" className="sp-results" role="listbox">
          {results.map((s, i) => (
            <li key={s.id} id={`sp-${s.id}`} role="option" aria-selected={i === sel}>
              <button type="button" onClick={() => pick(s.id)} onMouseEnter={() => setSel(i)}>
                <DomainGlyph domain={s.company.domain} />
                <span className="sp-name">
                  {s.company.name}
                  {!s.primary && <span className="sp-sub"> · {s.label}</span>}
                </span>
                <span className="sp-builds">{s.company.builds}</span>
                <span className="sp-place">{s.place}</span>
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="sp-empty">No matches. Try “reactor”, “Cedar Park” or “chips”.</li>}
        </ul>
      </div>
    </div>
  );
}
