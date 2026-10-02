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

/** "Scroll to fly the loop", or, until the live map is ready, how far along it is. */
function ScrollHint() {
  const ready = useAtlas((s) => s.ready);
  const progress = useAtlas((s) => s.loadProgress);
  return (
    <p className="scroll-hint" aria-hidden="true">
      {ready ? (
        <>
          Scroll to fly the loop <span>↓</span>
        </>
      ) : (
        <>
          Loading the live map
          <span className="hint-bar">
            <i style={{ transform: `scaleX(${Math.max(0.04, progress)})` }} />
          </span>
        </>
      )}
    </p>
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
          <ScrollHint />
        </>
      )}
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
