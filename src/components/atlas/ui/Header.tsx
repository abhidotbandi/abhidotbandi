"use client";

import { useAtlas, type AtlasMode } from "@/lib/atlas/store";
import { IconInfo, IconList, IconSearch, IconTrain, Logomark } from "./icons";

export default function Header({ onMode }: { onMode: (m: AtlasMode) => void }) {
  const mode = useAtlas((s) => s.mode);
  const setSearchOpen = useAtlas((s) => s.setSearchOpen);
  const setListOpen = useAtlas((s) => s.setListOpen);
  const setAboutOpen = useAtlas((s) => s.setAboutOpen);

  return (
    <header className="atlas-header">
      <a className="wordmark" data-obstacle href="/atlas" aria-label="Silicon Hills: Austin hard tech, mapped">
        <Logomark />
        <span className="wm-text">
          <span className="wm-name">Silicon Hills</span>
          <span className="wm-sub">Austin hard tech, mapped</span>
        </span>
      </a>
      <nav className="header-actions" data-obstacle aria-label="Atlas">
        <div className="seg" role="group" aria-label="Mode">
          <button type="button" aria-pressed={mode === "tour"} onClick={() => onMode("tour")}>
            Tour
          </button>
          <button type="button" aria-pressed={mode === "explore"} onClick={() => onMode("explore")}>
            Explore
          </button>
          <button
            type="button"
            aria-pressed={mode === "ride"}
            onClick={() => onMode("ride")}
            className="seg-ride"
            aria-label="Ride the Red Line"
          >
            <IconTrain />
            <span className="hide-sm">Red Line</span>
          </button>
        </div>
        <button type="button" className="icon-btn" onClick={() => setSearchOpen(true)} aria-label="Search companies">
          <IconSearch />
          <kbd className="hide-sm">⌘K</kbd>
        </button>
        <button type="button" className="icon-btn" onClick={() => setListOpen(true)} aria-label="All companies as a table">
          <IconList />
        </button>
        <button type="button" className="icon-btn" onClick={() => setAboutOpen(true)} aria-label="About this atlas and sources">
          <IconInfo />
        </button>
      </nav>
    </header>
  );
}
