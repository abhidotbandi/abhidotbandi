"use client";

import { useEffect, useRef, useState } from "react";
import type LocatorJson from "@/data/atlas/locator.json";
import { viewFov } from "@/lib/atlas/framing";
import { clamp } from "@/lib/atlas/geo";
import { runtime } from "@/lib/atlas/store";

type LocatorData = typeof LocatorJson;

/** The drawing's width in px (atlas.css), so marks can be sized in px within the km viewBox. */
const DRAW_PX = 126;
/** The view cone's length and the dot's radius, px. */
const CONE_PX = 26;
const DOT_PX = 3.3;
const DEG = Math.PI / 180;

/**
 * Where the camera is in the region, as in the Levels.fyi atlases: a small north-up map in the
 * corner (scripts/atlas/build_locator.py) with a dot at the middle of the view and a cone the way
 * the camera faces, as wide as it sees. Its caption names the city under the camera, or else the
 * county. The map's data loads once the page is up; the marks follow the camera without React.
 */
export default function Locator() {
  const [data, setData] = useState<LocatorData | null>(null);
  const cone = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const caption = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let live = true;
    import("@/data/atlas/locator.json").then((m) => live && setData(m.default));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!data) return;
    const [fx, fz, fw, fh] = data.frame;
    const { cell, cols, rows, runs } = data.grid;
    const grid = new Uint8Array(cols * rows);
    for (let i = 0, at = 0; i < runs.length; i += 2) {
      grid.fill(runs[i + 1], at, at + runs[i]);
      at += runs[i];
    }
    const k = fw / DRAW_PX; // km a px
    dot.current?.setAttribute("r", String(DOT_PX * k));
    let last = "";
    let named = -2;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const c = runtime.cam;
      const key = `${c.x.toFixed(2)} ${c.z.toFixed(2)} ${c.bearing.toFixed(1)} ${window.innerWidth}x${window.innerHeight}`;
      if (key === last) return;
      last = key;
      const x = clamp(c.x, fx, fx + fw);
      const z = clamp(c.z, fz, fz + fh);
      dot.current?.setAttribute("cx", x.toFixed(2));
      dot.current?.setAttribute("cy", z.toFixed(2));
      // The cone: from the dot the way the camera faces, as wide as its view across.
      const aspect = window.innerWidth / Math.max(1, window.innerHeight);
      const half = Math.atan(Math.tan((viewFov(window.innerWidth, window.innerHeight) * DEG) / 2) * aspect);
      const b = c.bearing * DEG;
      const r = CONE_PX * k;
      const p = (a: number) => `${(x + Math.sin(a) * r).toFixed(2)} ${(z - Math.cos(a) * r).toFixed(2)}`;
      cone.current?.setAttribute("d", `M${x.toFixed(2)} ${z.toFixed(2)}L${p(b - half)}A${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${p(b + half)}Z`);
      // The caption: the city (or county) under the middle of the view.
      const ix = Math.floor((c.x - fx) / cell);
      const iz = Math.floor((c.z - fz) / cell);
      const n = ix >= 0 && iz >= 0 && ix < cols && iz < rows ? grid[iz * cols + ix] : -1;
      if (n !== named && caption.current) {
        named = n;
        caption.current.textContent = n > 0 ? data.names[n] : "Central Texas";
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data]);

  if (!data) return null;
  const [fx, fz, fw, fh] = data.frame;
  return (
    <figure className="locator" data-obstacle aria-hidden="true">
      <svg viewBox={`${fx} ${fz} ${fw} ${fh}`}>
        <path className="lc-county" d={data.counties} />
        <path className="lc-travis" d={data.travis} />
        <path className="lc-water" d={data.water} />
        <path className="lc-river" d={data.river} />
        <path ref={cone} className="lc-cone" />
        <circle ref={dot} className="lc-dot" />
      </svg>
      <figcaption>
        N ↑ · <span ref={caption} />
      </figcaption>
    </figure>
  );
}
