"use client";

import { STOPS } from "@/data/atlas/tour";
import { useAtlas } from "@/lib/atlas/store";
import { forwardWheel } from "./wheel";

/** The tour's chapters down the left on wide screens: where you are, and a jump to any of them. */
export default function ChapterNav({ onJump }: { onJump: (i: number) => void }) {
  const active = useAtlas((s) => s.activeStop);
  const mode = useAtlas((s) => s.mode);
  return (
    <nav className="chapter-nav" data-obstacle={mode === "tour" ? "" : undefined} aria-label="Chapters" onWheel={forwardWheel}>
      <ol>
        {STOPS.map((s, i) => (
          <li key={s.id}>
            <button type="button" aria-current={active === i ? "step" : undefined} tabIndex={mode === "tour" ? 0 : -1} onClick={() => onJump(i)}>
              <i aria-hidden="true">{i === 0 ? "◈" : String(i).padStart(2, "0")}</i>
              <em>{s.name}</em>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
