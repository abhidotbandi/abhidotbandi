"use client";

import { COMPANIES } from "@/data/atlas/companies";
import { DOMAINS, DOMAIN_ORDER } from "@/data/atlas/domains";
import { useAtlas } from "@/lib/atlas/store";
import { DomainGlyph } from "./glyphs";

const TIMES: [string, number][] = [
  ["Morning", 0.24],
  ["Noon", 0.5],
  ["Golden", 0.8],
  ["Night", 1],
];

const counts = Object.fromEntries(DOMAIN_ORDER.map((d) => [d, COMPANIES.filter((c) => c.domain === d).length]));

export default function ExplorePanel() {
  const domains = useAtlas((s) => s.domains);
  const toggleDomain = useAtlas((s) => s.toggleDomain);
  const defenseOnly = useAtlas((s) => s.defenseOnly);
  const setDefenseOnly = useAtlas((s) => s.setDefenseOnly);
  const tod = useAtlas((s) => s.exploreTod);
  const setTod = useAtlas((s) => s.setExploreTod);

  return (
    <section className="explore-panel" data-obstacle aria-label="Map filters">
      <h2 className="ep-title">Domains</h2>
      <ul className="ep-domains">
        {DOMAIN_ORDER.map((id) => (
          <li key={id}>
            <button type="button" aria-pressed={domains.has(id)} onClick={() => toggleDomain(id)} data-domain={id}>
              <DomainGlyph domain={id} />
              <span className="ep-label">{DOMAINS[id].label}</span>
              <span className="ep-count">{counts[id]}</span>
            </button>
          </li>
        ))}
      </ul>
      <label className="ep-switch">
        <input type="checkbox" checked={defenseOnly} onChange={(e) => setDefenseOnly(e.target.checked)} />
        <span className="ep-switch-track" aria-hidden="true" />
        Only companies with defense customers
      </label>
      <div className="ep-tod" role="group" aria-label="Time of day">
        {TIMES.map(([label, t]) => (
          <button key={label} type="button" aria-pressed={Math.abs(tod - t) < 0.01} onClick={() => setTod(t)}>
            {label}
          </button>
        ))}
      </div>
      <p className="ep-hint">Drag to pan · right-drag or two fingers to tilt · scroll or pinch to zoom</p>
    </section>
  );
}
