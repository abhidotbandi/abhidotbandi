"use client";

import { useEffect, useRef } from "react";
import { PLACE_BY_ID } from "@/data/atlas/places";
import { useAtlas } from "@/lib/atlas/store";
import { IconClose, IconPin } from "./icons";

/** The card for a landmark, park or other place on the map. */
export default function PlacePanel({ onShowOnMap }: { onShowOnMap: (placeId: string) => void }) {
  const selected = useAtlas((s) => s.selectedPlace);
  const mode = useAtlas((s) => s.mode);
  const selectPlace = useAtlas((s) => s.selectPlace);
  const panelRef = useRef<HTMLElement>(null);
  const place = selected ? PLACE_BY_ID.get(selected) : undefined;

  // As with the company card: focus the card, not a control in it.
  useEffect(() => {
    if (place) panelRef.current?.focus({ preventScroll: true });
  }, [place]);

  if (!place) return null;
  return (
    <aside ref={panelRef} tabIndex={-1} className="company-panel place-panel" data-obstacle aria-label={`${place.name} details`}>
      <div className="cp-head">
        <span className="cp-domain">
          <IconPin />
          {place.kind}
        </span>
        <button type="button" className="icon-btn cp-close" onClick={() => selectPlace(null)} aria-label="Close">
          <IconClose />
        </button>
      </div>
      <h2 className="cp-name">{place.name}</h2>
      <p className="cp-blurb">{place.blurb}</p>
      <ul className="cp-facts">
        {place.facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      {mode !== "explore" && (
        <div className="cp-actions">
          <button type="button" className="btn btn-primary" onClick={() => onShowOnMap(place.id)}>
            Show on map
          </button>
        </div>
      )}
      <details className="cp-sources">
        <summary>Sources</summary>
        <ul>
          {place.sources.map((s) => (
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
