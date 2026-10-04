"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useAtlas } from "@/lib/atlas/store";
import { Logomark } from "./icons";
import { CompanyTable } from "./ListView";

/** What the loader says it's doing, by how far along the load is. */
const STEPS: [number, string][] = [
  [0, "Surveying Central Texas"],
  [0.2, "Raising the hills"],
  [0.4, "Filling Lady Bird Lake"],
  [0.6, "Laying out the streets"],
  [0.8, "Building downtown"],
  [0.95, "Lighting up the city"],
];

function stepAt(p: number): string {
  let text = STEPS[0][1];
  for (const [at, t] of STEPS) if (p >= at) text = t;
  return text;
}

/** Downtown's towers either side of the Capitol, bottoms on the far bank (y 56). */
const TOWERS = [
  "M15 56V41h8v15Z",
  "M24.5 56V27.5Q28 22.5 31.5 27.5V56Z", // the Austonian
  "M33 56V34h8.5v22Z",
  "M44 56v-9.5h-1v-7h2v-7h8v7h-1v7h2V56Z", // the Independent, the "Jenga" tower
  "M55.5 56V44h6v12Z",
  "M98.5 56V45h6v11Z",
  "M106 56V33l2-2v-2l2.5-4.5L113 29v2l2 2v23Z", // Frost Bank Tower
  "M117 56V22.5h2v-3h6v3h2V56Z", // Sixth and Guadalupe
  "M129 56V35h8v21Z",
  "M138.5 56V42h7v14Z",
];

/** Lit windows, as [x, y]. */
const WINDOWS = [
  [26.5, 31],
  [29, 38],
  [35, 40],
  [48, 36],
  [109.5, 38],
  [120, 27],
  [123, 35],
  [132, 40],
];

/** Bats leaving from under the bridge, as [x, y]. */
const BATS = [
  [62, 61],
  [84, 62],
  [74, 61.5],
  [96, 61],
  [68, 62],
  [90, 61.5],
  [56, 62],
];

/** A wave across the loader, one hump every 8 units, so drifting it by 16 loops seamlessly. */
const wave = (x0: number, y: number, amp: number) => `M${x0} ${y}q4 -${amp} 8 0${"t8 0".repeat(22)}`;

/**
 * The opening scene, drawn in while the map loads: the Capitol against a dusk sun, downtown's
 * towers rising either side, the Congress Avenue Bridge across Lady Bird Lake, and its bats.
 */
function AustinScene() {
  return (
    <svg className="ld-art" viewBox="0 0 160 80" aria-hidden="true">
      <circle className="la-sun" cx="80" cy="31" r="15" />
      <g className="la-towers">
        {TOWERS.map((d, i) => (
          <path key={i} className="la-grow" d={d} />
        ))}
      </g>
      <path className="la-draw la-mast" pathLength={1} d="M110.5 24.5v-4" />
      <g className="la-capitol">
        <rect className="la-grow" x="62" y="49" width="36" height="7" />
        <path className="la-grow" d="M71 56V43l9-3.5 9 3.5v13Z" />
        <rect className="la-grow" x="74.5" y="34.5" width="11" height="6" />
        <path className="la-dome" d="M74 35c0-7.5 2.8-11 6-11s6 3.5 6 11Z" />
        <rect className="la-lantern" x="78.7" y="19.8" width="2.6" height="4.6" />
        <path className="la-draw la-statue" pathLength={1} d="M80 20v-4.5" />
        <circle className="la-star" cx="80" cy="15" r="0.9" />
      </g>
      <g className="la-windows">
        {WINDOWS.map(([x, y], i) => (
          <rect key={i} x={x} y={y} width="1.2" height="1.8" />
        ))}
      </g>
      <path className="la-draw la-deck" pathLength={1} d="M8 56.6h144" />
      <path
        className="la-draw la-arches"
        pathLength={1}
        d="M14 65Q23.43 51.6 32.86 65Q42.29 51.6 51.71 65Q61.14 51.6 70.57 65Q80 51.6 89.43 65Q98.86 51.6 108.29 65Q117.71 51.6 127.14 65Q136.57 51.6 146 65"
      />
      <path className="la-piers" d="M14 57.5V65M32.86 57.5V65M51.71 57.5V65M70.57 57.5V65M89.43 57.5V65M108.29 57.5V65M127.14 57.5V65M146 57.5V65" />
      <g className="la-bats">
        {BATS.map(([x, y], i) => (
          <g key={i}>
            <path d={`M${x - 3.4} ${y}Q${x - 1.7} ${y - 2.1} ${x} ${y}Q${x + 1.7} ${y - 2.1} ${x + 3.4} ${y}`} />
          </g>
        ))}
      </g>
      <path className="la-water" d={wave(-8, 68.5, 2.2)} />
      <path className="la-water" d={wave(0, 73.5, 1.8)} />
    </svg>
  );
}

/**
 * Where the bar shows the load: its own progress, crept a little further while a step takes its
 * time (compiling the map's shaders, at the end, reports nothing until it's done), so the train
 * never stands still; full once the map is up.
 */
function useShownProgress(progress: number, ready: boolean): number {
  const [crept, setCrept] = useState(0);
  useEffect(() => {
    if (ready) return;
    const id = setInterval(
      () =>
        setCrept((s) => {
          const base = Math.max(s, progress);
          const cap = Math.min(0.97, progress + 0.15);
          return base < cap ? base + (cap - base) * 0.05 : base;
        }),
      300,
    );
    return () => clearInterval(id);
  }, [progress, ready]);
  return ready ? 1 : Math.max(crept, progress);
}

/**
 * The atlas opens on this while the map is built: Austin drawing itself in, the name, and a Red
 * Line train riding the progress bar; then it wipes away upward to the live map (`done`). If the
 * map can't start, the atlas as a table instead.
 */
export default function Loader({ done }: { done: boolean }) {
  const ready = useAtlas((s) => s.ready);
  const progress = useAtlas((s) => s.loadProgress);
  const failed = useAtlas((s) => s.webglFailed);
  const shown = useShownProgress(progress, ready);
  // Gone for good once the wipe is over, so its loops stop.
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setGone(true), 1000);
    return () => clearTimeout(t);
  }, [done]);

  if (failed) {
    return (
      <div className="atlas-fallback" role="region" aria-label="Companies">
        <div className="fallback-inner">
          <Logomark size={34} />
          <h1>Silicon Hills</h1>
          <p>
            This browser couldn&apos;t start the 3D map, so here is the atlas as a table: the deep tech, hard tech and
            defense tech companies and labs of Greater Austin, and the big tech and finance firms around them.
          </p>
          <CompanyTable />
        </div>
      </div>
    );
  }
  if (gone) return null;

  return (
    <div className="loader" data-done={done ? "1" : "0"} aria-hidden={done}>
      <div className="ld-center">
        <div className="ld-scene">
          <AustinScene />
        </div>
        <p className="ld-title">
          <span className="sr-only">Austin</span>
          {"AUSTIN".split("").map((ch, i) => (
            <span key={i} className="ld-ch" aria-hidden="true" style={{ "--i": i } as CSSProperties}>
              {ch}
            </span>
          ))}
        </p>
        <div
          className="ld-bar"
          role="progressbar"
          aria-label="Loading the map"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          style={{ "--p": shown } as CSSProperties}
        >
          <i className="ld-fill" />
          <i className="ld-car">
            <b className="ld-train" />
          </i>
        </div>
        <p className="ld-line">{ready ? "Welcome to Austin" : stepAt(progress)}</p>
      </div>
      <p className="ld-foot">Silicon Hills · Austin hard tech, mapped</p>
    </div>
  );
}
