"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SITES, labelFigure, type SiteRef } from "@/data/atlas/companies";
import { DOMAINS } from "@/data/atlas/domains";
import { PLACES, PLACE_BY_LABEL, type PlaceRef } from "@/data/atlas/places";
import { STOPS } from "@/data/atlas/tour";
import type { AtlasAssets, LabelPoint } from "@/lib/atlas/assets";
import { groundY, type HeightField } from "@/lib/atlas/geo";
import { runtime, useAtlas } from "@/lib/atlas/store";
import { sky } from "@/lib/atlas/timeOfDay";
import { siteAnchors } from "../scene/Beacons";
import { siteEmphasis } from "../scene/siteState";
import { DomainGlyph } from "./glyphs";

type Kind = "site" | "town" | "hood" | "water" | "landmark" | "shield" | "station" | "place";

interface Entry {
  kind: Kind;
  el: HTMLElement;
  x: number;
  y: number;
  z: number;
  rank: number;
  site?: SiteRef;
  place?: PlaceRef;
  /** measured sizes: [w, h] compact and with the detail line */
  size: [number, number];
  sizeDetail: [number, number];
  on: boolean;
  detail: boolean;
  /** which of the site placements it last took, so it doesn't flip between sides */
  opt: number;
}

/** Where a site label can sit around its beacon head at (sx, sy), in order of preference. */
function siteSpot(k: number, sx: number, sy: number, w: number, h: number): [number, number] {
  switch (k) {
    case 0:
      return [sx - w / 2, sy - h - 5];
    case 1:
      return [sx + 9, sy - h / 2];
    case 2:
      return [sx - w - 9, sy - h / 2];
    case 3:
      return [sx + 6, sy - h - 6];
    case 4:
      return [sx - w - 6, sy - h - 6];
    default:
      return [sx - w / 2, sy + 9];
  }
}

const stopSites = STOPS.map((s) => new Set(s.sites));
const v = new THREE.Vector3();

/** Module-level registry shared by the DOM layer (writes) and the render loop (reads). */
class LabelSystem {
  entries: Entry[] = [];
  night = false;
  root: HTMLElement | null = null;
  private obstacleEls: Element[] = [];
  private obstacleAt = 0;

  /** Screen rects of UI panels labels must not sit under (cards, header, panels). */
  private obstacles(out: number[]) {
    const now = performance.now();
    if (now - this.obstacleAt > 400) {
      this.obstacleAt = now;
      this.obstacleEls = Array.from(document.querySelectorAll("[data-obstacle]"));
    }
    for (const el of this.obstacleEls) {
      const op = (el as HTMLElement).style.opacity;
      if (op !== "" && Number(op) < 0.35) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push(r.left - 6, r.top - 6, r.right + 6, r.bottom + 6);
    }
  }

  /**
   * Sizes as shown: compact labels in the unfocused style, detailed ones focused. Reads and
   * style changes go in batches (every label read in one state, then the next), so the page lays
   * out three times, not twice for every label.
   */
  measure() {
    const sites = this.entries.filter((e) => e.kind === "site");
    for (const e of this.entries) {
      if (e.kind === "site") continue;
      e.size = [e.el.offsetWidth, e.el.offsetHeight];
      e.sizeDetail = e.size;
    }
    const was = sites.map((e) => [e.el.dataset.detail ?? "0", e.el.dataset.focus ?? "0"]);
    for (const e of sites) e.el.dataset.detail = e.el.dataset.focus = "0";
    for (const e of sites) e.size = [e.el.offsetWidth, e.el.offsetHeight];
    for (const e of sites) e.el.dataset.detail = e.el.dataset.focus = "1";
    for (const e of sites) e.sizeDetail = [e.el.offsetWidth, e.el.offsetHeight];
    sites.forEach((e, i) => {
      e.el.dataset.detail = was[i][0];
      e.el.dataset.focus = was[i][1];
    });
  }

  private visible(e: Entry, dist: number, mode: string): boolean {
    switch (e.kind) {
      case "site":
        return !Number.isNaN(siteAnchors[e.site!.index * 3]);
      case "town":
        return dist > 4.5 && (e.rank === 1 || (e.rank === 2 ? dist < 120 : dist < 42));
      case "hood":
        return dist < 6.5;
      case "water":
        return e.rank === 1 ? dist < 90 : dist < 40;
      case "landmark":
        return e.rank === 1 ? dist < 26 : e.rank === 2 ? dist < 13 : dist < 6.5;
      case "shield":
        return dist < 48 && dist > 1.2;
      case "station":
        return mode === "ride" || dist < 20;
      case "place":
        return dist < 9;
    }
  }

  private priority(e: Entry, mode: string, activeStop: number, sel: string | null): number {
    if (e.kind === "site") {
      const s = e.site!;
      if (s.id === sel) return 1000;
      const tier = (4 - s.company.tier) * 60;
      if (mode === "tour") return (stopSites[activeStop]?.has(s.id) ? 600 : 120) + tier + (s.primary ? 10 : 0);
      return 300 + tier + siteEmphasis[s.index] * 50 + (s.primary ? 10 : 0);
    }
    switch (e.kind) {
      case "town":
        return e.rank === 1 ? 420 : e.rank === 2 ? 180 : 70;
      case "station":
        return mode === "ride" ? 700 : 85;
      case "water":
        return e.rank === 1 ? 150 : 90;
      case "landmark":
        return e.rank === 1 ? 160 : e.rank === 2 ? 95 : 55;
      case "shield":
        return 65;
      case "hood":
        return 40;
      case "place":
        return 110;
    }
    return 0;
  }

  update(camera: THREE.Camera, W: number, H: number) {
    const st = useAtlas.getState();
    const dist = runtime.cam.dist;
    const night = sky.uNight.value > 0.5;
    if (night !== this.night && this.root) {
      this.night = night;
      this.root.dataset.night = night ? "1" : "0";
    }
    const cands: { e: Entry; sx: number; sy: number; p: number }[] = [];
    for (const e of this.entries) {
      if (!this.visible(e, dist, st.mode)) {
        this.hide(e);
        continue;
      }
      if (e.kind === "site") {
        const i = e.site!.index * 3;
        v.set(siteAnchors[i], siteAnchors[i + 1], siteAnchors[i + 2]);
      } else {
        v.set(e.x, e.y, e.z);
      }
      v.project(camera);
      if (v.z > 1 || v.z < -1) {
        this.hide(e);
        continue;
      }
      const sx = ((v.x + 1) / 2) * W;
      const sy = ((1 - v.y) / 2) * H;
      if (sx < -80 || sx > W + 80 || sy < -40 || sy > H + 40) {
        this.hide(e);
        continue;
      }
      cands.push({ e, sx, sy, p: this.priority(e, st.mode, st.activeStop, st.selectedSite) });
    }
    cands.sort((a, b) => b.p - a.p);

    const placed: number[] = []; // x0,y0,x1,y1 quads
    this.obstacles(placed);
    const edge = 6;
    const hit = (x0: number, y0: number, x1: number, y1: number) => {
      if (x0 < edge || y0 < edge || x1 > W - edge || y1 > H - edge) return true;
      for (let i = 0; i < placed.length; i += 4) {
        if (x0 < placed[i + 2] && x1 > placed[i] && y0 < placed[i + 3] && y1 > placed[i + 1]) return true;
      }
      return false;
    };
    const pad = 3;
    // Hovering must never move anything: the layout below ignores it, and the hovered label then
    // opens up in place (from the same anchor, so it still covers the pointer), drawn on top.
    const hov = st.hoveredSite;
    let hovered: { c: (typeof cands)[number] } | null = null;
    for (const c of cands) {
      const e = c.e;
      const focus = e.kind === "site" && c.p >= 550;
      const [w, h] = focus ? e.sizeDetail : e.size;
      let x0: number;
      let y0: number;
      if (e.kind === "site") {
        // Above the beacon head if there's room; otherwise the side it had last, then the rest.
        let spot: [number, number] | null = null;
        for (const k of [0, e.opt, 1, 2, 3, 4, 5]) {
          const [ox, oy] = siteSpot(k, c.sx, c.sy, w, h);
          if (!hit(ox - pad, oy - pad, ox + w + pad, oy + h + pad)) {
            spot = [ox, oy];
            e.opt = k;
            break;
          }
        }
        if (!spot) {
          if (e.site!.id === hov) hovered = { c };
          else this.hide(e);
          continue;
        }
        [x0, y0] = spot;
      } else {
        x0 = c.sx - w / 2;
        y0 = c.sy - h / 2;
        if (hit(x0 - pad, y0 - pad, x0 + w + pad, y0 + h + pad)) {
          this.hide(e);
          continue;
        }
      }
      placed.push(x0 - pad, y0 - pad, x0 + w + pad, y0 + h + pad);
      if (e.kind === "site" && e.site!.id === hov) {
        hovered = { c };
        continue;
      }
      this.show(e, x0, y0, focus, false);
      if (e.kind === "site") e.el.dataset.sel = e.site!.id === st.selectedSite ? "1" : "0";
    }
    // The hovered site: in its place, or (if it had no room, say its beacon is hovered) over
    // the others without displacing them.
    for (const e of this.entries) if (e.kind === "site" && e.el.dataset.hover === "1" && e.site!.id !== hov) e.el.dataset.hover = "0";
    if (hovered) {
      const { c } = hovered;
      const e = c.e;
      const [w, h] = e.sizeDetail;
      const [x0, y0] = siteSpot(e.opt, c.sx, c.sy, w, h);
      this.show(e, x0, y0, true, true);
      e.el.dataset.sel = e.site!.id === st.selectedSite ? "1" : "0";
    }
  }

  private show(e: Entry, x0: number, y0: number, detail: boolean, hover: boolean) {
    if (e.detail !== detail) {
      e.detail = detail;
      e.el.dataset.detail = detail ? "1" : "0";
    }
    e.el.style.transform = `translate3d(${x0.toFixed(1)}px, ${y0.toFixed(1)}px, 0)`;
    if (!e.on) {
      e.on = true;
      e.el.dataset.on = "1";
    }
    if (e.kind === "site") {
      e.el.dataset.focus = detail ? "1" : "0";
      if (hover) e.el.dataset.hover = "1";
    }
  }

  private hide(e: Entry) {
    if (e.on) {
      e.on = false;
      e.el.dataset.on = "0";
    }
  }
}

export const labelSystem = new LabelSystem();

/** Lives inside the Canvas so labels update right after the camera and beacons. */
export function LabelDriver() {
  const size = useThree((s) => s.size);
  useFrame(({ camera }) => labelSystem.update(camera, size.width, size.height));
  return null;
}

function point(ground: HeightField, l: LabelPoint, lift = 0.02): [number, number, number] {
  return [l.x, groundY(ground, l.x, l.z) + lift, l.z];
}

/** Every map label as DOM, positioned by the label system. Decorative: the same content is in the cards and list. */
export function LabelLayer({ assets, ground }: { assets: AtlasAssets; ground: HeightField }) {
  const root = useRef<HTMLDivElement>(null);
  const selectSite = useAtlas((s) => s.selectSite);
  const hoverSite = useAtlas((s) => s.hoverSite);
  const selectPlace = useAtlas((s) => s.selectPlace);
  const L = assets.vectors.labels;
  /** A map label that opens a place's card, or plain text. */
  const named = (kind: Kind, i: number, cls: string, text: string, extra: Record<string, string | number | undefined> = {}) => {
    const place = PLACE_BY_LABEL.get(text);
    if (!place) {
      return (
        <span key={`${kind}${i}`} data-label={kind} data-idx={i} className={cls} {...extra}>
          {text}
        </span>
      );
    }
    return (
      <button
        key={`${kind}${i}`}
        type="button"
        tabIndex={-1}
        data-label={kind}
        data-idx={i}
        className={`${cls} al-clickable`}
        onClick={() => selectPlace(place.id)}
        {...extra}
      >
        {text}
      </button>
    );
  };

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    labelSystem.root = el;
    const entries: Entry[] = [];
    el.querySelectorAll<HTMLElement>("[data-label]").forEach((node) => {
      const kind = node.dataset.label as Kind;
      const idx = Number(node.dataset.idx);
      let x = 0;
      let y = 0;
      let z = 0;
      let rank = 1;
      let site: SiteRef | undefined;
      let place: PlaceRef | undefined;
      if (kind === "site") {
        site = SITES[idx];
      } else if (kind === "place") {
        place = PLACES[idx];
        [x, y, z] = point(ground, { text: place.name, x: place.x, z: place.z }, 0.02);
      } else if (kind === "station") {
        const st = assets.vectors.redLine.stations[idx];
        [x, y, z] = point(ground, { text: st.name, x: st.x, z: st.z }, 0.03);
      } else {
        const list = { town: L.towns, hood: L.neighborhoods, water: L.water, landmark: L.landmarks, shield: L.shields }[kind];
        const lp = list[idx];
        [x, y, z] = point(ground, lp);
        rank = kind === "water" ? (lp.kind === "lake" ? 1 : 2) : (lp.rank ?? 1);
      }
      // Take visibility from the DOM: when the layer re-registers (the ground changes as central
      // Austin loads) labels already showing must still be hidden when they fall out of view.
      const on = node.dataset.on === "1";
      entries.push({ kind, el: node, x, y, z, rank, site, place, size: [0, 0], sizeDetail: [0, 0], on, detail: false, opt: 0 });
    });
    labelSystem.entries = entries;
    labelSystem.measure();
    // Keep sizes true as web fonts swap in (fonts.ready can resolve before labels' fonts even
    // start loading): each label reports its size in whichever state it's in.
    const byEl = new Map(entries.map((e) => [e.el as Element, e]));
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((records) => {
            for (const r of records) {
              const e = byEl.get(r.target);
              if (!e) continue;
              const size: [number, number] = [e.el.offsetWidth, e.el.offsetHeight];
              if (e.kind !== "site") e.size = e.sizeDetail = size;
              else if (e.el.dataset.detail === "1") e.sizeDetail = size;
              else e.size = size;
            }
          });
    for (const e of entries) ro?.observe(e.el);
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) labelSystem.measure();
    });
    return () => {
      cancelled = true;
      ro?.disconnect();
      labelSystem.entries = [];
      labelSystem.root = null;
    };
  }, [assets, L, ground]);

  // Wheel over a label should still scroll the story (tour) or zoom the map (explore).
  const onWheel = (e: React.WheelEvent) => {
    const mode = useAtlas.getState().mode;
    if (mode === "tour") document.getElementById("atlas-scroller")?.scrollBy({ top: e.deltaY });
    else document.querySelector("#atlas-canvas canvas")?.dispatchEvent(new WheelEvent("wheel", e.nativeEvent));
  };

  return (
    <div ref={root} className="atlas-labels" aria-hidden="true" onWheel={onWheel}>
      {L.water.map((l, i) => named("water", i, "al al-water", l.text))}
      {L.towns.map((l, i) => (
        <span key={`t${i}`} data-label="town" data-idx={i} className="al al-town" data-rank={l.rank}>
          {l.text}
        </span>
      ))}
      {L.neighborhoods.map((l, i) => (
        <span key={`h${i}`} data-label="hood" data-idx={i} className="al al-hood">
          {l.text}
        </span>
      ))}
      {L.landmarks.map((l, i) => named("landmark", i, "al al-landmark", l.text))}
      {PLACES.filter((p) => !p.label).map((p) => (
        <button
          key={`p${p.index}`}
          type="button"
          tabIndex={-1}
          data-label="place"
          data-idx={p.index}
          className="al al-landmark al-clickable"
          onClick={() => selectPlace(p.id)}
        >
          {p.name}
        </button>
      ))}
      {L.shields.map((l, i) => (
        <span key={`s${i}`} data-label="shield" data-idx={i} className="al al-shield">
          {l.text}
        </span>
      ))}
      {assets.vectors.redLine.stations.map((l, i) => (
        <span key={`r${i}`} data-label="station" data-idx={i} className="al al-station">
          {l.name}
        </span>
      ))}
      {SITES.map((s) => {
        const d = DOMAINS[s.company.domain];
        const fig = s.primary ? labelFigure(s.company) : undefined;
        return (
          <button
            key={s.id}
            type="button"
            tabIndex={-1}
            data-label="site"
            data-idx={s.index}
            data-domain={d.id}
            data-inst={s.company.status.kind === "institution" ? "1" : "0"}
            className="al al-site"
            onClick={() => selectSite(s.id)}
            onPointerEnter={() => hoverSite(s.id)}
            onPointerLeave={() => hoverSite(null)}
          >
            <DomainGlyph domain={d.id} />
            <span className="al-site-text">
              <span className="al-site-name">
                {s.company.name}
                {!s.primary && <span className="al-site-sub"> · {s.place}</span>}
                {fig && (
                  <span className="al-site-figure" data-kind={fig.kind}>
                    {fig.text}
                  </span>
                )}
              </span>
              <span className="al-site-detail">{s.primary ? s.company.builds : s.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
