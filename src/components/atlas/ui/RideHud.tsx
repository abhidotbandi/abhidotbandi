"use client";

import { useEffect, useRef, useState } from "react";
import { SITES } from "@/data/atlas/companies";
import type { Station } from "@/lib/atlas/assets";
import { runtime, seekRide, useAtlas } from "@/lib/atlas/store";
import { CompanyLogo } from "./CompanyLogo";
import { IconNext, IconPause, IconPlay, IconPrev, IconRestart } from "./icons";

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

interface Near {
  id: string;
  name: string;
  company: (typeof SITES)[number]["company"];
  km: number;
  dir: string;
}

function nearby(): Near[] {
  const { x, z } = runtime.trainPos;
  return SITES.map((s) => {
    const dx = s.x - x;
    const dz = s.z - z;
    const km = Math.hypot(dx, dz);
    const brg = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
    return { id: s.id, name: s.company.name, company: s.company, km, dir: COMPASS[Math.round(brg / 45) % 8] };
  })
    .filter((n) => n.km < 6)
    .sort((a, b) => a.km - b.km)
    .slice(0, 4);
}

export default function RideHud({ stations }: { stations: Station[] }) {
  const p = useAtlas((s) => s.rideProgress);
  const paused = useAtlas((s) => s.ridePaused);
  const setPaused = useAtlas((s) => s.setRidePaused);
  const selectSite = useAtlas((s) => s.selectSite);
  const [near, setNear] = useState<Near[]>([]);
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNear(nearby()), 400);
    return () => window.clearInterval(id);
  }, []);

  const prev = stations.findLast((s) => s.at < p - 0.002);
  const next = stations.find((s) => s.at > p + 0.002);
  const atStation = stations.find((s) => Math.abs(s.at - p) < 0.006);
  const done = p >= 1;

  // Stations sit too close together on the bar to be separate targets (Kramer and
  // McKalla are under 1% apart), so the bar scrubs and the buttons step stop to stop.
  const scrub = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (r) seekRide((clientX - r.left) / r.width);
  };

  return (
    <section className="ride-hud" data-obstacle aria-label="Red Line ride">
      <div className="rh-top">
        <p className="rh-line">
          <span className="rh-bullet" aria-hidden="true" />
          CapMetro Red Line · Leander → Downtown
        </p>
        <div className="rh-controls">
          <button
            type="button"
            className="icon-btn"
            disabled={!prev}
            onClick={() => prev && seekRide(prev.at)}
            aria-label={prev ? `Back to ${prev.name}` : "Previous stop"}
          >
            <IconPrev />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              if (done) {
                seekRide(0);
                setPaused(false);
              } else {
                setPaused(!paused);
              }
            }}
            aria-label={done ? "Ride again" : paused ? "Play" : "Pause"}
          >
            {done ? <IconRestart /> : paused ? <IconPlay /> : <IconPause />}
          </button>
          <button
            type="button"
            className="icon-btn"
            disabled={!next}
            onClick={() => next && seekRide(next.at)}
            aria-label={next ? `Skip to ${next.name}` : "Next stop"}
          >
            <IconNext />
          </button>
        </div>
      </div>
      <p className="rh-now" aria-live="polite">
        {done ? "Downtown. End of the line." : atStation ? `${atStation.name} station` : `Next stop: ${next?.name ?? "Downtown"}`}
      </p>
      <div
        className="rh-scrub"
        aria-hidden="true"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          scrub(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e.clientX);
        }}
      >
        <div className="rh-track" ref={track}>
          <div className="rh-fill" style={{ width: `${p * 100}%` }} />
          {stations.map((s) => (
            <span
              key={s.name}
              className="rh-stop"
              style={{ left: `${s.at * 100}%` }}
              data-passed={s.at <= p + 0.001 ? "1" : "0"}
              title={s.name}
            />
          ))}
        </div>
      </div>
      <div className="rh-ends" aria-hidden="true">
        <span>Leander</span>
        <span>Downtown</span>
      </div>
      {near.length > 0 && (
        <div className="rh-near">
          <p className="rh-near-title">Nearby</p>
          <ul>
            {near.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => selectSite(n.id)}>
                  <CompanyLogo company={n.company} />
                  <span className="rh-near-name">{n.name}</span>
                  <span className="rh-near-dist">
                    {n.km.toFixed(1)} km {n.dir}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
