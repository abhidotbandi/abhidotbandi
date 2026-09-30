"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { SITE_BY_ID } from "@/data/atlas/companies";
import { PLACE_BY_ID } from "@/data/atlas/places";
import { STOPS } from "@/data/atlas/tour";
import { loadAtlasAssets, loadCentralAssets } from "@/lib/atlas/assets";
import { clamp, project } from "@/lib/atlas/geo";
import { makePaddleRoute } from "@/lib/atlas/paddle";
import { runtime, seekPaddle, seekRide, useAtlas, type AtlasMode } from "@/lib/atlas/store";
import { isLowPower } from "@/lib/atlas/tier";
import { getTimeline } from "@/lib/atlas/tour";
import type { PreparedScene } from "./scene/prepare";
import { StoryCard } from "./ui/Story";
import { LabelLayer } from "./ui/labels";
import Header from "./ui/Header";
import ChapterRail from "./ui/ChapterRail";
import CompanyPanel from "./ui/CompanyPanel";
import PlacePanel from "./ui/PlacePanel";
import ExplorePanel from "./ui/ExplorePanel";
import RideHud from "./ui/RideHud";
import PaddleHud from "./ui/PaddleHud";
import SearchPalette from "./ui/SearchPalette";
import ListView from "./ui/ListView";
import About from "./ui/About";
import Loader from "./ui/Loader";

const AtlasCanvas = dynamic(() => import("./scene/AtlasCanvas"), { ssr: false });

function hasWebGL2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

/** Camera view for looking at one company site. */
export function flyToSite(id: string) {
  const s = SITE_BY_ID.get(id);
  if (!s) return;
  const cur = runtime.cam;
  runtime.flyTo = {
    x: s.x,
    z: s.z,
    dist: clamp(s.radius * 7, 1.3, 7),
    tilt: 58,
    bearing: cur.bearing,
  };
}

/** Camera view for a place, in the light it looks best in. */
export function flyToPlace(id: string) {
  const p = PLACE_BY_ID.get(id);
  if (!p) return;
  runtime.flyTo = { x: p.x, z: p.z, dist: p.view.dist, tilt: p.view.tilt, bearing: p.view.bearing };
  if (p.view.tod !== undefined) useAtlas.getState().setExploreTod(p.view.tod);
}

export default function AtlasApp() {
  const [scene, setScene] = useState<PreparedScene | null>(null);
  /** central Austin's detail couldn't load: the regional map carries on without it */
  const [centralFailed, setCentralFailed] = useState(false);
  const [vh, setVh] = useState(900);
  const [narrow, setNarrow] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLElement | null)[]>([]);
  const mode = useAtlas((s) => s.mode);
  const setMode = useAtlas((s) => s.setMode);
  const ready = useAtlas((s) => s.ready);
  const webglFailed = useAtlas((s) => s.webglFailed);
  const selectSite = useAtlas((s) => s.selectSite);
  const selected = useAtlas((s) => s.selectedSite);
  const selectedPlace = useAtlas((s) => s.selectedPlace);
  const selectPlace = useAtlas((s) => s.selectPlace);
  const timeline = getTimeline();
  const central = scene?.central?.data;
  const paddleRoute = useMemo(() => (central ? makePaddleRoute(central) : null), [central]);

  // Load and prepare everything while the loader is up.
  useEffect(() => {
    let cancelled = false;
    const st = useAtlas.getState();
    if (!hasWebGL2()) {
      st.setWebglFailed();
      return;
    }
    runtime.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The atlas opens on the city, so central Austin's street-scale detail loads alongside the
    // regional map, and the loader stays up until both are in. The regional scene mounts first,
    // so its shaders compile while the detail is still arriving.
    const lowPower = isLowPower();
    const got = [0, 0];
    const report = (i: number) => (p: number) => {
      got[i] = p;
      st.setLoadProgress(got[0] * 0.44 + got[1] * 0.44);
    };
    const central = loadCentralAssets(lowPower, report(1));
    loadAtlasAssets(lowPower, report(0))
      .then(async (assets) => {
        // Let the progress bar paint before the CPU-heavy extrusion.
        await new Promise((r) => setTimeout(r, 30));
        const { prepareScene, upgradeScene } = await import("./scene/prepare");
        if (cancelled) return;
        const base = prepareScene(assets);
        setScene(base);
        central
          .then(async (c) => {
            await new Promise((r) => setTimeout(r, 30));
            if (cancelled) return;
            st.setLoadProgress(0.94);
            setScene(upgradeScene(base, c));
          })
          .catch((err) => {
            console.error("atlas: central Austin detail failed to load", err);
            if (!cancelled) setCentralFailed(true);
          });
      })
      .catch((err) => {
        console.error("atlas: failed to load map data", err);
        if (!cancelled) st.setWebglFailed();
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Viewport height drives the scroll timeline (1 "screen" = 1 viewport height).
  useLayoutEffect(() => {
    const measure = () => {
      setVh(scroller.current?.clientHeight || window.innerHeight);
      setNarrow(window.innerWidth < 760);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const cardAnchor = narrow ? 0.66 : 0.5;

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const H = el.clientHeight || 1;
    runtime.scroll = el.scrollTop / H;
    cards.current.forEach((c, i) => {
      if (!c) return;
      const d = Math.abs(runtime.scroll - timeline.stopCenter(i));
      c.style.opacity = String(clamp(1.3 - d * 1.5, 0, 1));
      c.style.pointerEvents = d < 0.6 ? "auto" : "none";
    });
  }, [timeline]);

  useEffect(() => {
    onScroll();
  }, [onScroll, vh]);

  const scrollToStop = useCallback(
    (i: number) => {
      const el = scroller.current;
      if (!el) return;
      el.scrollTo({ top: timeline.stopCenter(i) * el.clientHeight, behavior: runtime.reducedMotion ? "auto" : "smooth" });
    },
    [timeline],
  );

  const switchMode = useCallback(
    (m: AtlasMode) => {
      if (m === "ride") {
        seekRide(useAtlas.getState().rideProgress >= 1 ? 0 : runtime.rideS);
        // With reduced motion the train waits for an explicit Play.
        useAtlas.getState().setRidePaused(runtime.reducedMotion);
      }
      if (m === "paddle") {
        seekPaddle(useAtlas.getState().paddleProgress >= 1 ? 0 : runtime.paddleS);
        useAtlas.getState().setPaddlePaused(runtime.reducedMotion);
      }
      setMode(m);
    },
    [setMode],
  );

  // Selecting a site while exploring flies the camera there.
  useEffect(
    () =>
      useAtlas.subscribe((s, prev) => {
        if (s.selectedSite && s.selectedSite !== prev.selectedSite && s.mode === "explore") flyToSite(s.selectedSite);
        if (s.selectedPlace && s.selectedPlace !== prev.selectedPlace && s.mode === "explore") flyToPlace(s.selectedPlace);
      }),
    [],
  );

  // Keyboard: ⌘K / "/" search, Esc closes things.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useAtlas.getState();
      const typing = (e.target as HTMLElement)?.closest("input, textarea, [contenteditable]");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        st.setSearchOpen(true);
      } else if (e.key === "Escape") {
        if (st.searchOpen) st.setSearchOpen(false);
        else if (st.listOpen) st.setListOpen(false);
        else if (st.aboutOpen) st.setAboutOpen(false);
        else if (st.selectedSite) st.selectSite(null);
        else if (st.selectedPlace) st.selectPlace(null);
        else if (st.mode !== "tour") st.setMode("tour");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Deep links: ?c=<site>, ?p=<place>, ?mode=explore, ?ride=1, ?paddle=1, ?at=lat,lon[,dist km,tilt,bearing][&tod=0..1]
  useEffect(() => {
    if (!ready) return;
    const q = new URLSearchParams(window.location.search);
    const c = q.get("c");
    const p = q.get("p");
    const at = q.get("at")?.split(",").map(Number);
    const tod = Number(q.get("tod"));
    if (q.has("tod") && Number.isFinite(tod)) useAtlas.getState().setExploreTod(clamp(tod, 0, 1));
    if (q.get("ride") === "1") switchMode("ride");
    else if (q.get("paddle") === "1") switchMode("paddle");
    else if (at && at.length >= 2 && at.every(Number.isFinite)) {
      const [lat, lon, dist = 2, tilt = 55, bearing = 0] = at;
      const [x, z] = project(lon, lat);
      switchMode("explore");
      runtime.flyTo = { x, z, dist: clamp(dist, 0.2, 150), tilt: clamp(tilt, 0, 75), bearing };
    } else if (p && PLACE_BY_ID.has(p)) {
      switchMode("explore");
      selectPlace(p);
      flyToPlace(p);
    } else if (c && SITE_BY_ID.has(c)) {
      switchMode("explore");
      selectSite(c);
      flyToSite(c);
    } else if (q.get("mode") === "explore") switchMode("explore");
  }, [ready, selectSite, selectPlace, switchMode]);

  const trackHeight = (timeline.total + 1) * vh;

  return (
    <div className="atlas" data-mode={mode} data-ready={ready ? "1" : "0"} data-selected={selected || selectedPlace ? "1" : "0"}>
      <div id="atlas-canvas" className="atlas-canvas" aria-hidden="true">
        {scene && !webglFailed && <AtlasCanvas scene={scene} settled={!!scene.central || centralFailed} />}
      </div>
      {scene && !webglFailed && <LabelLayer assets={scene.assets} ground={scene.ground} />}

      <div id="atlas-scroller" ref={scroller} className="atlas-scroller" onScroll={onScroll} tabIndex={-1}>
        <div className="story-track" style={{ height: trackHeight }}>
          {STOPS.map((stop, i) => (
            <StoryCard
              key={stop.id}
              ref={(el) => {
                cards.current[i] = el;
              }}
              stop={stop}
              index={i}
              top={(timeline.stopCenter(i) + cardAnchor) * vh}
              onExplore={() => switchMode("explore")}
              onRide={() => switchMode("ride")}
              onPaddle={() => switchMode("paddle")}
            />
          ))}
        </div>
      </div>

      <Header onMode={switchMode} />
      {mode === "tour" && <ChapterRail onJump={scrollToStop} />}
      {mode === "explore" && <ExplorePanel />}
      {mode === "ride" && scene && <RideHud stations={scene.assets.vectors.redLine.stations} />}
      {mode === "paddle" && paddleRoute && <PaddleHud route={paddleRoute} />}
      <CompanyPanel onShowOnMap={(id) => {
        switchMode("explore");
        flyToSite(id);
      }} />
      <PlacePanel onShowOnMap={(id) => {
        switchMode("explore");
        flyToPlace(id);
      }} />
      <SearchPalette
        onPick={(id) => {
          switchMode("explore");
          selectSite(id);
          flyToSite(id);
        }}
        onPickPlace={(id) => {
          switchMode("explore");
          selectPlace(id);
          flyToPlace(id);
        }}
      />
      <ListView onPick={(id) => {
        switchMode("explore");
        selectSite(id);
        flyToSite(id);
      }} />
      <About />
      <Loader />
    </div>
  );
}
