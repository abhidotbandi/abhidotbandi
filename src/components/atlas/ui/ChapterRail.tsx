"use client";

import { STOPS } from "@/data/atlas/tour";
import { useAtlas } from "@/lib/atlas/store";

export default function ChapterRail({ onJump }: { onJump: (i: number) => void }) {
  const active = useAtlas((s) => s.activeStop);
  return (
    <nav className="chapter-rail" data-obstacle aria-label="Tour stops">
      <p className="rail-count" aria-hidden="true">
        {String(active).padStart(2, "0")} <span>/ {STOPS.length - 1}</span>
      </p>
      <ol>
        {STOPS.map((s, i) => (
          <li key={s.id}>
            <button type="button" aria-current={active === i ? "step" : undefined} onClick={() => onJump(i)}>
              <span className="rail-label">{s.name}</span>
              <span className="rail-dot" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
