import { create } from "zustand";
import type { DomainId } from "@/data/atlas/domains";
import type { CamState } from "./camera";

export type AtlasMode = "tour" | "explore" | "ride";

interface AtlasState {
  mode: AtlasMode;
  setMode: (m: AtlasMode) => void;

  /** stop whose card is closest to the viewport centre */
  activeStop: number;
  setActiveStop: (i: number) => void;

  selectedSite: string | null;
  hoveredSite: string | null;
  selectSite: (id: string | null) => void;
  hoverSite: (id: string | null) => void;
  /** a landmark, park or other place whose card is open (not a company site) */
  selectedPlace: string | null;
  selectPlace: (id: string | null) => void;

  domains: Set<DomainId>;
  toggleDomain: (d: DomainId) => void;
  defenseOnly: boolean;
  setDefenseOnly: (v: boolean) => void;

  loadProgress: number;
  ready: boolean;
  setLoadProgress: (p: number) => void;
  setReady: () => void;
  webglFailed: boolean;
  setWebglFailed: () => void;

  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  listOpen: boolean;
  setListOpen: (v: boolean) => void;
  aboutOpen: boolean;
  setAboutOpen: (v: boolean) => void;

  /** time of day while exploring (0 dawn … 1 night) */
  exploreTod: number;
  setExploreTod: (t: number) => void;

  /** Red Line ride: 0..1 along the line */
  rideProgress: number;
  ridePaused: boolean;
  setRideProgress: (p: number) => void;
  setRidePaused: (v: boolean) => void;
}

export const useAtlas = create<AtlasState>((set, get) => ({
  mode: "tour",
  setMode: (mode) => set({ mode }),

  activeStop: 0,
  setActiveStop: (activeStop) => {
    if (get().activeStop !== activeStop) set({ activeStop });
  },

  selectedSite: null,
  hoveredSite: null,
  selectSite: (selectedSite) => set(selectedSite ? { selectedSite, selectedPlace: null } : { selectedSite }),
  hoverSite: (hoveredSite) => {
    if (get().hoveredSite !== hoveredSite) set({ hoveredSite });
  },
  selectedPlace: null,
  selectPlace: (selectedPlace) => set(selectedPlace ? { selectedPlace, selectedSite: null } : { selectedPlace }),

  domains: new Set<DomainId>(["defense-space", "chips-compute", "energy-mobility", "robotics-mfg"]),
  toggleDomain: (d) => {
    const next = new Set(get().domains);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    set({ domains: next });
  },
  defenseOnly: false,
  setDefenseOnly: (defenseOnly) => set({ defenseOnly }),

  loadProgress: 0,
  ready: false,
  setLoadProgress: (loadProgress) => set({ loadProgress }),
  setReady: () => set({ ready: true, loadProgress: 1 }),
  webglFailed: false,
  setWebglFailed: () => set({ webglFailed: true }),

  searchOpen: false,
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  listOpen: false,
  setListOpen: (listOpen) => set({ listOpen }),
  aboutOpen: false,
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),

  exploreTod: 0.5,
  setExploreTod: (exploreTod) => set({ exploreTod }),

  rideProgress: 0,
  ridePaused: false,
  setRideProgress: (rideProgress) => set({ rideProgress }),
  setRidePaused: (ridePaused) => set({ ridePaused }),
}));

/**
 * Per-frame values that change too often for React state. Written by the scroll
 * handler and the render loop, read by the render loop and the label layer.
 */
export const runtime = {
  /** tour scroll position in screens */
  scroll: 0,
  /** current camera state (whatever mode drives it) */
  cam: { x: 0, z: 0, dist: 90, tilt: 40, bearing: 0 } as CamState,
  tod: 0.1,
  /** a fly-to requested by the UI in explore mode */
  flyTo: null as CamState | null,
  reducedMotion: false,
  /** pixels the scene's focal point is shifted to make room for cards */
  viewOffset: { x: 0, y: 0 },
  trainPos: { x: 0, z: 0, heading: 0 },
  /** Red Line ride position, 0..1 (source of truth; the store mirrors it for the HUD) */
  rideS: 0,
};

export function seekRide(s: number) {
  runtime.rideS = Math.max(0, Math.min(1, s));
  useAtlas.getState().setRideProgress(runtime.rideS);
}
