"use client";

import { useRef } from "react";
import type { PaddleRoute } from "@/lib/atlas/paddle";
import { seekPaddle, useAtlas } from "@/lib/atlas/store";
import { IconNext, IconPause, IconPin, IconPlay, IconPrev, IconRestart } from "./icons";

/** The Paddle Lady Bird Lake controls: progress, play/pause, and what's passing by. */
export default function PaddleHud({ route }: { route: PaddleRoute }) {
  const p = useAtlas((s) => s.paddleProgress);
  const paused = useAtlas((s) => s.paddlePaused);
  const setPaused = useAtlas((s) => s.setPaddlePaused);
  const selectPlace = useAtlas((s) => s.selectPlace);
  const track = useRef<HTMLDivElement>(null);
  const wps = route.waypoints;
  const L = route.path.length;

  const prev = wps.findLast((w) => w.s < p - 0.004);
  const next = wps.find((w) => w.s > p + 0.004);
  const passing = wps.find((w) => Math.abs(w.s - p) * L < 0.12);
  const done = p >= 1;
  const ahead = wps.filter((w) => w.s > p + 0.004).slice(0, 3);

  const scrub = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (r) seekPaddle((clientX - r.left) / r.width);
  };

  return (
    <section className="ride-hud paddle-hud" data-obstacle aria-label="Paddle Lady Bird Lake">
      <div className="rh-top">
        <p className="rh-line">
          <span className="rh-bullet" aria-hidden="true" />
          Lady Bird Lake · Red Bud Isle → Longhorn Dam
        </p>
        <div className="rh-controls">
          <button
            type="button"
            className="icon-btn"
            disabled={!prev}
            onClick={() => prev && seekPaddle(prev.s)}
            aria-label={prev ? `Back to ${prev.name}` : "Previous landmark"}
          >
            <IconPrev />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              if (done) {
                seekPaddle(0);
                setPaused(false);
              } else {
                setPaused(!paused);
              }
            }}
            aria-label={done ? "Paddle again" : paused ? "Play" : "Pause"}
          >
            {done ? <IconRestart /> : paused ? <IconPlay /> : <IconPause />}
          </button>
          <button
            type="button"
            className="icon-btn"
            disabled={!next}
            onClick={() => next && seekPaddle(next.s)}
            aria-label={next ? `Skip to ${next.name}` : "Next landmark"}
          >
            <IconNext />
          </button>
        </div>
      </div>
      <p className="rh-now" aria-live="polite">
        {done
          ? "Longhorn Dam. End of the lake."
          : passing
            ? `${passing.kind === "bridge" ? "Under" : "Passing"} ${passing.name}`
            : next
              ? `Next: ${next.name}, ${((next.s - p) * L).toFixed(1)} km`
              : "Almost at Longhorn Dam"}
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
          {wps.map((w) => (
            <span
              key={w.name}
              className="rh-stop"
              data-kind={w.kind}
              style={{ left: `${w.s * 100}%` }}
              data-passed={w.s <= p + 0.001 ? "1" : "0"}
              title={w.name}
            />
          ))}
        </div>
      </div>
      <div className="rh-ends" aria-hidden="true">
        <span>Red Bud Isle</span>
        <span>Longhorn Dam</span>
      </div>
      {ahead.length > 0 && (
        <div className="rh-near">
          <p className="rh-near-title">Ahead</p>
          <ul>
            {ahead.map((w) => (
              <li key={w.name}>
                {w.placeId ? (
                  <button type="button" onClick={() => selectPlace(w.placeId!)}>
                    <IconPin />
                    <span className="rh-near-name">{w.name}</span>
                    <span className="rh-near-dist">{((w.s - p) * L).toFixed(1)} km</span>
                  </button>
                ) : (
                  <span className="rh-near-row">
                    <span className="rh-near-bridge" aria-hidden="true" />
                    <span className="rh-near-name">{w.name}</span>
                    <span className="rh-near-dist">{((w.s - p) * L).toFixed(1)} km</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
