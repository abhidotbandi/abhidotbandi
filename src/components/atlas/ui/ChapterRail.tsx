"use client";

import { forwardRef, type CSSProperties } from "react";
import { STOPS } from "@/data/atlas/tour";
import { useAtlas } from "@/lib/atlas/store";
import { getTimeline } from "@/lib/atlas/tour";
import { forwardWheel } from "./wheel";

/**
 * The tour as a Red Line down the right edge: a stop for each chapter at its place along the
 * scroll, and a train riding down to where the story is, filling the line red behind it. The
 * line's `--p` (0..1) is set as the story scrolls (AtlasApp), so the train keeps up without
 * React; a stop turns red as the train reaches it.
 */
const ChapterRail = forwardRef<HTMLDivElement, { onJump: (i: number) => void }>(function ChapterRail({ onJump }, ref) {
  const active = useAtlas((s) => s.activeStop);
  const mode = useAtlas((s) => s.mode);
  const timeline = getTimeline();
  return (
    <nav className="tour-rail" data-obstacle={mode === "tour" ? "" : undefined} aria-label="Tour progress" onWheel={forwardWheel}>
      <div ref={ref} className="tr-line">
        <i className="tr-fill" />
        {STOPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className="tr-stop"
            style={{ "--at": timeline.stopCenter(i) / timeline.total } as CSSProperties}
            aria-current={active === i ? "step" : undefined}
            aria-label={s.name}
            tabIndex={mode === "tour" ? 0 : -1}
            onClick={() => onJump(i)}
          >
            <span className="tr-tip" aria-hidden="true">
              {s.name}
            </span>
          </button>
        ))}
        <i className="tr-train" />
      </div>
    </nav>
  );
});

export default ChapterRail;
