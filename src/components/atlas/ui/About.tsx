"use client";

import { useAtlas } from "@/lib/atlas/store";
import { IconClose } from "./icons";

export default function About() {
  const open = useAtlas((s) => s.aboutOpen);
  const setOpen = useAtlas((s) => s.setAboutOpen);
  if (!open) return null;
  return (
    <div className="modal-scrim" onClick={() => setOpen(false)}>
      <div className="about" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="icon-btn about-close" onClick={() => setOpen(false)} aria-label="Close">
          <IconClose />
        </button>
        <h2 id="about-title">About this atlas</h2>
        <p>
          Silicon Hills maps the companies and labs building physical and defense technology around Austin:
          warships, rockets, satellites, humanoid robots, reactors, fabs and the chips inside all of them. It is an
          independent project inspired by{" "}
          <a href="https://www.levels.fyi/atlas" target="_blank" rel="noreferrer">
            The Peninsula
          </a>
          , Levels.fyi&apos;s atlas of Silicon Valley.
        </p>
        <h3>How it was made</h3>
        <p>
          Companies were included if they build deep or hard technology (or run a defense, space or semiconductor lab)
          and have a real site in the Austin region. Every figure links to a public source and carries an as-of date;
          anything not publicly reported is left out rather than estimated. Locations were geocoded against Overture
          Maps addresses and places and checked against building footprints. Details are current as of September 2026.
        </p>
        <p>
          Colour marks a company&apos;s domain, and every marker also carries a shape and a label, so nothing depends on
          colour alone. The <button type="button" className="link" onClick={() => {
            setOpen(false);
            useAtlas.getState().setListOpen(true);
          }}>table view</button> lists everything on the map.
        </p>
        <h3>Map data</h3>
        <ul>
          <li>
            Buildings, roads, rail, water, parks and places: © <a href="https://overturemaps.org" target="_blank" rel="noreferrer">Overture Maps Foundation</a>{" "}
            (CDLA Permissive 2.0), including © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> (ODbL).
          </li>
          <li>
            Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">Terrain Tiles on AWS</a> (Mapzen), from USGS 3DEP and SRTM.
          </li>
          <li>Vertical scale is exaggerated 3× for terrain and 1.6× for buildings so the hills read.</li>
        </ul>
      </div>
    </div>
  );
}
