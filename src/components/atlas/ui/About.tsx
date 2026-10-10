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
          warships, rockets, satellites, humanoid robots, reactors, fabs and the chips inside all of them, and the
          big tech companies and trading firms around them. It is an independent project inspired by{" "}
          <a href="https://www.levels.fyi/atlas" target="_blank" rel="noreferrer">
            The Peninsula
          </a>
          , Levels.fyi&apos;s atlas of Silicon Valley.
        </p>
        <h3>How it was made</h3>
        <p>
          Companies were included if they build deep or hard technology (or run a defense, space or semiconductor lab)
          and have a real site in the Austin region. Big tech and finance firms were included if they appear in
          Levels.fyi&apos;s atlases and have a real Austin office, not a store or a bank branch; Dell and Indeed, both
          headquartered here, are included too. Every figure links to a public source and carries an as-of date;
          anything not publicly reported is left out rather than estimated. Locations were geocoded against Overture
          Maps addresses and places and checked against building footprints. Details were last checked in September
          and October 2026.
        </p>
        <p>
          Each label carries the company&apos;s logo, ringed in its domain&apos;s colour; the legend, the company cards and
          the table give every domain a shape as well, so nothing depends on colour alone. The logos are trademarks of
          their owners, shown only to say whose site is whose. The <button type="button" className="link" onClick={() => {
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
            Heights of the towers Overture is missing or has too short: CTBUH, via Wikipedia&apos;s{" "}
            <a href="https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Austin" target="_blank" rel="noreferrer">
              list of the tallest buildings in Austin
            </a>
            , and storey counts.
          </li>
          <li>
            Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">Terrain Tiles on AWS</a> (Mapzen), from USGS 3DEP and SRTM.
          </li>
          <li>
            Footprints Overture doesn&apos;t have yet (Austin-Bergstrom&apos;s terminal and paving, Tower Business Park in
            Buda) were traced from USGS orthoimagery and Copernicus Sentinel-2 imagery (contains modified Copernicus
            Sentinel data, 2026), with the owners&apos; plans and Texas TDLR filings.
          </li>
          <li>Vertical scale is exaggerated 3× for terrain and 1.6× for buildings so the hills read.</li>
        </ul>
      </div>
    </div>
  );
}
