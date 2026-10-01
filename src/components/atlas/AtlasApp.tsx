"use client";

import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { SITE_BY_ID } from "@/data/atlas/companies";
import { PLACE_BY_ID } from "@/data/atlas/places";
import { PORTRAIT_POSTER_MEDIA, POSTERS } from "@/data/atlas/poster";
import { STOPS } from "@/data/atlas/tour";
import { fetchCentralFiles, fetchRegionalFiles } from "@/lib/atlas/assets";
import { posterCss, posterPlacement } from "@/lib/atlas/framing";
import { clamp, project } from "@/lib/atlas/geo";
import { makePaddleRoute } from "@/lib/atlas/paddle";
import { runtime, seekPaddle, seekRide, useAtlas, type AtlasMode } from "@/lib/atlas/store";
import { mark } from "@/lib/atlas/perf";
import { startPrep } from "@/lib/atlas/prep/client";
import { isLowPower } from "@/lib/atlas/tier";
import { getTimeline } from "@/lib/atlas/tour";
import type { PreparedScene } from "./scene/prepare";
import { StoryCard } from "./ui/Story";
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

// The map and its labels (three.js and all) load apart from the page's first script, which only
// has to put up the poster and the story; the load effect asks for them straight away.
const loadCanvas = () => import("./scene/AtlasCanvas");
const loadLabels = () => import("./ui/labels");
const AtlasCanvas = dynamic(loadCanvas, { ssr: false });
const LabelLayer = dynamic(() => loadLabels().then((m) => m.LabelLayer), { ssr: false });

/**
 * Whether the browser has WebGL 2 at all. Only the API is checked: making a context just to ask
 * costs a GPU context of its own at the busiest moment of the load. If the map's own context
 * can't be made, SceneBoundary catches it.
 */
function hasWebGL2(): boolean {
  return typeof WebGL2RenderingContext !== "undefined";
}

/** The map failed to start (no usable WebGL, or a scene error): the page carries on as a list. */
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error("atlas: the map failed to start", err);
    useAtlas.getState().setWebglFailed();
  }
  render() {
    return this.state.failed ? null : this.props.children;
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
  /** the opening shot's poster image, until the live map has faded in over it */
  const [poster, setPoster] = useState(true);
  const posterImg = useRef<HTMLElement>(null);
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
    // regional map. The files were already requested by the page's early script (layout.tsx);
    // the prep worker decodes them and builds the scene's data off the main thread. The regional
    // scene mounts first, so its shaders compile while central Austin is still being built.
    const lowPower = isLowPower();
    mark("start");
    void loadCanvas();
    void loadLabels();
    const got = [0, 0];
    const report = (i: number) => (p: number) => {
      got[i] = p;
      st.setLoadProgress(got[0] * 0.3 + got[1] * 0.45);
    };
    const prep = startPrep(lowPower);
    const centralFiles = fetchCentralFiles(lowPower, report(1));
    fetchRegionalFiles(lowPower, report(0))
      .then((files) => prep.regional(files))
      .then(async (r) => {
        const { prepareScene, upgradeScene, withSiteModels } = await import("./scene/prepare");
        if (cancelled) return;
        mark("regional prepared");
        st.setLoadProgress(0.8);
        const base = prepareScene(r);
        setScene(base);
        centralFiles
          .then((files) => prep.central(files))
          .then((c) => {
            if (cancelled) return;
            mark("central prepared");
            st.setLoadProgress(0.95);
            setScene(upgradeScene(base, c));
          })
          .catch((err) => {
            console.error("atlas: central Austin detail failed to load", err);
            if (cancelled) return;
            setCentralFailed(true);
            prep
              .models()
              .then((m) => !cancelled && setScene(withSiteModels(base, m)))
              .catch(() => {});
          });
      })
      .catch((err) => {
        console.error("atlas: failed to load map data", err);
        if (!cancelled) st.setWebglFailed();
      });
    return () => {
      cancelled = true;
      prep.dispose();
    };
  }, []);

  // The poster: lined up exactly with where the live map will be, and gone once the map has
  // faded in over it. Deep links (they open elsewhere) and rendering the poster itself
  // (?poster=landscape|portrait, see scripts/atlas/render_poster.py) hide it.
  useLayoutEffect(() => {
    const q = new URLSearchParams(window.location.search).get("poster");
    const capture = q === "landscape" || q === "portrait" ? POSTERS[q] : null;
    if (capture) {
      runtime.poster = { fov: capture.fov, ppx: capture.ppx, ppy: capture.ppy };
      document.documentElement.classList.add("atlas-capture");
      return;
    }
    const place = () => {
      const img = posterImg.current;
      const box = document.getElementById("atlas-canvas");
      if (!img || !box) return;
      const p = window.matchMedia(PORTRAIT_POSTER_MEDIA).matches ? POSTERS.portrait : POSTERS.landscape;
      const r = posterPlacement(p, box.clientWidth, box.clientHeight);
      img.style.left = `${r.left}px`;
      img.style.top = `${r.top}px`;
      img.style.width = `${r.width}px`;
      img.style.height = `${r.height}px`;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);

  useEffect(() => {
    if (!ready || !poster) return;
    const t = setTimeout(() => setPoster(false), 1400);
    return () => clearTimeout(t);
  }, [ready, poster]);

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
      {poster && (
        <div className="atlas-poster" aria-hidden="true">
          <style>{posterCss()}</style>
          <i ref={posterImg} />
        </div>
      )}
      <div id="atlas-canvas" className="atlas-canvas" aria-hidden="true">
        {scene && !webglFailed && (
          <SceneBoundary>
            <AtlasCanvas scene={scene} settled={!!scene.central || centralFailed} />
          </SceneBoundary>
        )}
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
