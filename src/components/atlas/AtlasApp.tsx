"use client";

import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { SITE_BY_ID } from "@/data/atlas/companies";
import { PLACE_BY_ID } from "@/data/atlas/places";
import { STOPS } from "@/data/atlas/tour";
import { fetchCentralFiles, fetchRegionalFiles } from "@/lib/atlas/assets";
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
import ChapterNav from "./ui/ChapterNav";
import Hero from "./ui/Hero";
import CompanyPanel from "./ui/CompanyPanel";
import PlacePanel from "./ui/PlacePanel";
import ExplorePanel from "./ui/ExplorePanel";
import RideHud from "./ui/RideHud";
import PaddleHud from "./ui/PaddleHud";
import SearchPalette from "./ui/SearchPalette";
import ListView from "./ui/ListView";
import About from "./ui/About";
import Loader from "./ui/Loader";
import Locator from "./ui/Locator";

// The map and its labels (three.js and all) load apart from the page's first script, which only
// has to put up the loader; the load effect asks for them straight away.
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
  /** the opening: 0 loading, 1 the loader wiping away, 2 the title card up */
  const [opening, setOpening] = useState(0);
  /** the story is at its start, where the title card and "scroll to descend" go */
  const [atTop, setAtTop] = useState(true);
  const atTopRef = useRef(true);
  const [heroClosed, setHeroClosed] = useState(false);
  const railLine = useRef<HTMLDivElement>(null);
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

  // Once the map is up: the bar fills, the loader wipes away upward, and the title card rises
  // into view as the wipe passes the middle of the screen.
  useEffect(() => {
    if (!ready) return;
    const a = setTimeout(() => setOpening(1), 400);
    const b = setTimeout(() => setOpening(2), 750);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [ready]);

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
    // The title card stays up until the camera is about to leave the first stop.
    const top = runtime.scroll < timeline.dwell[0][1] - 0.2;
    if (top !== atTopRef.current) {
      atTopRef.current = top;
      setAtTop(top);
    }
    railLine.current?.style.setProperty("--p", clamp(runtime.scroll / timeline.total, 0, 1).toFixed(4));
    cards.current.forEach((c, i) => {
      if (!c) return;
      // Fully shown while the camera holds on the card's stop; fading as the camera flies in, and
      // a little quicker as it flies away (the card rising toward the header).
      const [a, b] = timeline.dwell[i];
      const s = runtime.scroll;
      const fade = s < a ? (a - s) * 2.4 : s > b ? (s - b) * 3.2 : 0;
      c.style.opacity = String(clamp(1 - fade, 0, 1));
      c.style.pointerEvents = fade < 0.6 ? "auto" : "none";
    });
  }, [timeline]);

  useEffect(() => {
    onScroll();
  }, [onScroll, vh]);

  // Where each card holds: its middle at the anchor, but never under the header or past the
  // bottom edge (a long card on a short screen holds just under the header). Its lane starts so
  // the card arrives there exactly as its stop's hold begins. Again whenever a card's size changes.
  useLayoutEffect(() => {
    const place = () => {
      const H = scroller.current?.clientHeight || window.innerHeight;
      const header = document.querySelector(".atlas-header")?.getBoundingClientRect().bottom ?? 0;
      cards.current.forEach((c, i) => {
        if (!c?.parentElement) return;
        const half = c.offsetHeight / 2;
        const lo = header + 12 + half;
        const hi = H - 12 - half;
        const mid = lo > hi ? lo : clamp(cardAnchor * H, lo, hi);
        c.style.top = `${mid}px`;
        c.parentElement.style.top = `${timeline.dwell[i][0] * H + mid}px`;
      });
    };
    place();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    cards.current.forEach((c) => c && ro?.observe(c));
    return () => ro?.disconnect();
  }, [cardAnchor, vh, timeline]);

  const scrollToStop = useCallback(
    (i: number) => {
      const el = scroller.current;
      if (!el) return;
      if (i === 0) setHeroClosed(false);
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
  const hint = opening >= 2 && atTop && mode === "tour";

  return (
    <div className="atlas" data-mode={mode} data-ready={ready ? "1" : "0"} data-selected={selected || selectedPlace ? "1" : "0"}>
      <div id="atlas-canvas" className="atlas-canvas" aria-hidden="true">
        {scene && !webglFailed && (
          <SceneBoundary>
            <AtlasCanvas scene={scene} settled={!!scene.central || centralFailed} />
          </SceneBoundary>
        )}
      </div>
      <div className="atlas-vignette" aria-hidden="true" />
      {scene && !webglFailed && <LabelLayer assets={scene.assets} ground={scene.ground} />}

      <div id="atlas-scroller" ref={scroller} className="atlas-scroller" onScroll={onScroll} tabIndex={-1}>
        <div className="story-track" style={{ height: trackHeight }}>
          {STOPS.map((stop, i) => {
            // Each card's lane: the card scrolls in with the page, holds still at its anchor for
            // as long as the camera holds on its stop (the lane's spacer), then scrolls on as the
            // camera flies to the next. The first stop has the title card instead.
            if (i === 0) return null;
            const [a, b] = timeline.dwell[i];
            return (
              <div key={stop.id} className="story-lane" style={{ top: (a + cardAnchor) * vh }}>
                <StoryCard
                  ref={(el) => {
                    cards.current[i] = el;
                  }}
                  stop={stop}
                  index={i}
                  top={cardAnchor * vh}
                  onExplore={() => switchMode("explore")}
                  onRide={() => switchMode("ride")}
                  onPaddle={() => switchMode("paddle")}
                />
                <div style={{ height: (b - a) * vh }} />
              </div>
            );
          })}
        </div>
      </div>

      <Hero on={opening >= 2 && atTop && !heroClosed && mode === "tour" && !selected && !selectedPlace} onClose={() => setHeroClosed(true)} />
      <div className="atlas-hint" data-on={hint ? "1" : "0"} data-obstacle={hint ? "" : undefined} aria-hidden="true">
        <span>Scroll to descend</span>
        <b>▾</b>
      </div>
      <Header onMode={switchMode} />
      <ChapterNav onJump={scrollToStop} />
      <ChapterRail ref={railLine} onJump={scrollToStop} />
      {mode === "explore" && <ExplorePanel />}
      {mode === "ride" && scene && <RideHud stations={scene.assets.vectors.redLine.stations} />}
      {mode === "paddle" && paddleRoute && <PaddleHud route={paddleRoute} />}
      {ready && !webglFailed && <Locator />}
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
      <Loader done={opening >= 1} />
    </div>
  );
}
