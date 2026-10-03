"use client";

import { forwardRef } from "react";
import { SITE_BY_ID, statusLine } from "@/data/atlas/companies";
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
  /** where the card's middle holds while its stop is on screen, px from the top */
  top: number;
  onExplore: () => void;
  onRide: () => void;
  onPaddle: () => void;
}

export const StoryCard = forwardRef<HTMLElement, CardProps>(function StoryCard({ stop, index, top, onExplore, onRide, onPaddle }, ref) {
  const isLast = index === STOPS.length - 1;
  return (
    <article
      ref={ref}
      className={`story-card${isLast ? " is-last" : ""}`}
      data-obstacle
      style={{ top }}
      aria-labelledby={`stop-${stop.id}`}
    >
      <p className="kicker">{stop.kicker}</p>
      <h2 id={`stop-${stop.id}`}>{stop.title}</h2>
      <p className="story-body">{stop.body}</p>
      {stop.sites.length > 0 && (
        <ul className="site-list" aria-label={`Companies at ${stop.name}`}>
          {stop.sites.map((id) => (
            <SiteRow key={id} id={id} />
          ))}
        </ul>
      )}
      {stop.id === "lake" && (
        <div className="cta-row">
          <button type="button" className="btn" onClick={onPaddle}>
            Paddle the lake
          </button>
        </div>
      )}
      {isLast && (
        <div className="cta-row">
          <button type="button" className="btn btn-primary" onClick={onExplore}>
            Explore the map
          </button>
          <button type="button" className="btn" onClick={onRide}>
            Ride the Red Line
          </button>
          <button type="button" className="btn" onClick={onPaddle}>
            Paddle Lady Bird Lake
          </button>
        </div>
      )}
    </article>
  );
});
