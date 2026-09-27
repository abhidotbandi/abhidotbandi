"use client";

import { forwardRef } from "react";
import { COMPANIES, SITE_BY_ID, SITES, statusLine } from "@/data/atlas/companies";
import { STOPS, type Stop } from "@/data/atlas/tour";
import { useAtlas } from "@/lib/atlas/store";
import { DomainGlyph } from "./glyphs";

function SiteRow({ id }: { id: string }) {
  const s = SITE_BY_ID.get(id);
  const selectSite = useAtlas((st) => st.selectSite);
  const hoverSite = useAtlas((st) => st.hoverSite);
  if (!s) return null;
  const c = s.company;
  return (
    <li>
      <button
        type="button"
        className="site-row"
        onClick={() => selectSite(s.id)}
        onPointerEnter={() => hoverSite(s.id)}
        onPointerLeave={() => hoverSite(null)}
        onFocus={() => hoverSite(s.id)}
        onBlur={() => hoverSite(null)}
      >
        <DomainGlyph domain={c.domain} />
        <span className="site-row-main">
          <span className="site-row-name">
            {c.name}
            {!s.primary && <span className="site-row-place"> · {s.place}</span>}
          </span>
          <span className="site-row-builds">{s.primary ? c.builds : s.label}</span>
        </span>
        <span className="site-row-status">{statusLine(c)}</span>
      </button>
    </li>
  );
}

interface CardProps {
  stop: Stop;
  index: number;
  top: number;
  onExplore: () => void;
  onRide: () => void;
}

export const StoryCard = forwardRef<HTMLElement, CardProps>(function StoryCard({ stop, index, top, onExplore, onRide }, ref) {
  const isIntro = index === 0;
  const isLast = index === STOPS.length - 1;
  return (
    <article
      ref={ref}
      className={`story-card${isIntro ? " is-intro" : ""}${isLast ? " is-last" : ""}`}
      data-obstacle
      style={{ top }}
      aria-labelledby={`stop-${stop.id}`}
    >
      <p className="kicker">{stop.kicker}</p>
      {isIntro ? (
        <h1 id={`stop-${stop.id}`}>{stop.title}</h1>
      ) : (
        <h2 id={`stop-${stop.id}`}>{stop.title}</h2>
      )}
      <p className="story-body">{stop.body}</p>
      {isIntro && (
        <>
          <dl className="intro-stats">
            <div>
              <dt>Companies & labs</dt>
              <dd>{COMPANIES.length}</dd>
            </div>
            <div>
              <dt>Sites mapped</dt>
              <dd>{SITES.length}</dd>
            </div>
            <div>
              <dt>With defense customers</dt>
              <dd>{COMPANIES.filter((c) => c.defense).length}</dd>
            </div>
          </dl>
          <p className="scroll-hint" aria-hidden="true">
            Scroll to fly the loop <span>↓</span>
          </p>
        </>
      )}
      {stop.sites.length > 0 && (
        <ul className="site-list" aria-label={`Companies at ${stop.name}`}>
          {stop.sites.map((id) => (
            <SiteRow key={id} id={id} />
          ))}
        </ul>
      )}
      {isLast && (
        <div className="cta-row">
          <button type="button" className="btn btn-primary" onClick={onExplore}>
            Explore the map
          </button>
          <button type="button" className="btn" onClick={onRide}>
            Ride the Red Line
          </button>
        </div>
      )}
    </article>
  );
});
