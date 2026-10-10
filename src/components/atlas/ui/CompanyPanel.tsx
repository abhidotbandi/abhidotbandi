"use client";

import { useEffect, useRef } from "react";
import { SITE_BY_ID, formatUsd, type Company } from "@/data/atlas/companies";
import { DOMAINS } from "@/data/atlas/domains";
import { useAtlas } from "@/lib/atlas/store";
import { CompanyLogo } from "./CompanyLogo";
import { DomainGlyph } from "./glyphs";
import { IconArrow, IconClose } from "./icons";

function Stats({ c }: { c: Company }) {
  const s = c.status;
  const rows: [string, string][] = [];
  if (c.founded) rows.push(["Founded", String(c.founded)]);
  if (s.kind === "public") rows.push(["Listed", `${s.exchange}: ${s.ticker}`]);
  if (s.kind === "subsidiary") rows.push(["Part of", s.parent]);
  if (s.kind === "institution") {
    rows.push(["Run by", s.parent]);
    if (s.est) rows.push(["In Austin since", String(s.est)]);
  }
  if (s.kind === "private") {
    if (s.valuation) rows.push(["Valuation", formatUsd(s.valuation)]);
    if (s.raised) rows.push(["Raised", formatUsd(s.raised)]);
    if (s.lastRound) rows.push(["Latest round", s.lastRound]);
    if (!s.valuation && !s.raised && !s.lastRound) rows.push(["Stage", "Venture-backed"]);
  }
  return (
    <dl className="cp-stats">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
      {s.kind === "private" && s.asOf && <p className="cp-asof">Figures as of {s.asOf}</p>}
      {s.kind === "public" && s.note && <p className="cp-asof">{s.note}</p>}
    </dl>
  );
}

export default function CompanyPanel({ onShowOnMap }: { onShowOnMap: (siteId: string) => void }) {
  const selected = useAtlas((s) => s.selectedSite);
  const mode = useAtlas((s) => s.mode);
  const selectSite = useAtlas((s) => s.selectSite);
  const panelRef = useRef<HTMLElement>(null);
  const site = selected ? SITE_BY_ID.get(selected) : undefined;

  // Move focus to the panel itself, not a control in it: when the selection came from
  // pressing Enter (search, table), the keypress that follows lands on whatever is focused
  // and would "click" a focused button.
  useEffect(() => {
    if (site) panelRef.current?.focus({ preventScroll: true });
  }, [site]);

  if (!site) return null;
  const c = site.company;
  const d = DOMAINS[c.domain];

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      className="company-panel"
      data-obstacle
      aria-label={`${c.name} details`}
      data-domain={c.domain}
    >
      <div className="cp-head">
        <span className="cp-domain">
          <DomainGlyph domain={c.domain} />
          {d.label}
        </span>
        {c.defense && <span className="cp-badge">Defense customers</span>}
        <button type="button" className="icon-btn cp-close" onClick={() => selectSite(null)} aria-label="Close">
          <IconClose />
        </button>
      </div>
      <div className="cp-title">
        <CompanyLogo company={c} />
        <h2 className="cp-name">{c.name}</h2>
      </div>
      <p className="cp-builds">{c.builds}</p>
      <p className="cp-blurb">{c.blurb}</p>
      <Stats c={c} />
      {c.facts.length > 0 && (
        <ul className="cp-facts">
          {c.facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      <section className="cp-sites" aria-label="Sites">
        <h3>In the Austin area</h3>
        <ul>
          {c.sites.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={s.id === site.id ? "is-current" : undefined}
                onClick={() => {
                  selectSite(s.id);
                  onShowOnMap(s.id);
                }}
              >
                <span className="cp-site-label">{s.label}</span>
                <span className="cp-site-addr">{s.address}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <div className="cp-actions">
        {mode !== "explore" && (
          <button type="button" className="btn btn-primary" onClick={() => onShowOnMap(site.id)}>
            Show on map
          </button>
        )}
        {c.url && (
          <a className="btn" href={c.url} target="_blank" rel="noreferrer">
            Website <IconArrow />
          </a>
        )}
      </div>
      <details className="cp-sources">
        <summary>Sources</summary>
        <ul>
          {c.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </aside>
  );
}
