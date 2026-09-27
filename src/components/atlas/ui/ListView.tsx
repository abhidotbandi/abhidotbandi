"use client";

import { useMemo, useState } from "react";
import { COMPANIES, statusLine, type Company } from "@/data/atlas/companies";
import { DOMAINS, DOMAIN_ORDER } from "@/data/atlas/domains";
import { useAtlas } from "@/lib/atlas/store";
import { DomainGlyph } from "./glyphs";
import { IconClose } from "./icons";

type SortKey = "name" | "domain" | "founded" | "place";

const sorters: Record<SortKey, (a: Company, b: Company) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  domain: (a, b) => DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain) || a.name.localeCompare(b.name),
  founded: (a, b) => (a.founded ?? 9999) - (b.founded ?? 9999),
  place: (a, b) => a.sites[0].place.localeCompare(b.sites[0].place),
};

/** The accessible, sortable equivalent of the map. */
export function CompanyTable({ onPick }: { onPick?: (siteId: string) => void }) {
  const [key, setKey] = useState<SortKey>("domain");
  const [dir, setDir] = useState(1);
  const rows = useMemo(() => [...COMPANIES].sort((a, b) => sorters[key](a, b) * dir), [key, dir]);
  const head = (k: SortKey, label: string) => (
    <th scope="col" aria-sort={key === k ? (dir > 0 ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => {
          if (key === k) setDir(-dir);
          else {
            setKey(k);
            setDir(1);
          }
        }}
      >
        {label}
        <span aria-hidden="true">{key === k ? (dir > 0 ? " ↑" : " ↓") : ""}</span>
      </button>
    </th>
  );
  return (
    <table className="company-table">
      <caption className="sr-only">Deep tech, hard tech and defense tech companies and labs in the Austin area</caption>
      <thead>
        <tr>
          {head("name", "Company")}
          {head("domain", "Domain")}
          <th scope="col">What they build</th>
          {head("place", "Where")}
          {head("founded", "Founded")}
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id}>
            <th scope="row">
              {onPick ? (
                <button type="button" className="ct-name" onClick={() => onPick(c.sites[0].id)}>
                  {c.name}
                </button>
              ) : (
                <span className="ct-name">{c.name}</span>
              )}
              {c.defense && <span className="ct-def" title="Has defense customers">DoD</span>}
            </th>
            <td className="ct-domain" data-domain={c.domain}>
              <DomainGlyph domain={c.domain} size={12} />
              {DOMAINS[c.domain].short}
            </td>
            <td>{c.builds}</td>
            <td>{[...new Set(c.sites.map((s) => s.place))].join(", ")}</td>
            <td className="ct-num">{c.founded ?? "—"}</td>
            <td>{statusLine(c)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ListView({ onPick }: { onPick: (siteId: string) => void }) {
  const open = useAtlas((s) => s.listOpen);
  const setOpen = useAtlas((s) => s.setListOpen);
  if (!open) return null;
  return (
    <div className="modal-scrim" onClick={() => setOpen(false)}>
      <div className="list-view" role="dialog" aria-modal="true" aria-label="All companies" onClick={(e) => e.stopPropagation()}>
        <div className="lv-head">
          <h2>All {COMPANIES.length} companies & labs</h2>
          <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <div className="lv-scroll">
          <CompanyTable
            onPick={(id) => {
              setOpen(false);
              onPick(id);
            }}
          />
        </div>
      </div>
    </div>
  );
}
