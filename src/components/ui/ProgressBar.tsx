"use client";

import { useGridStore } from "@/lib/store";
import { CHAPTER_BOUNDS } from "@/lib/chapters";

const LABELS: Record<string, string> = {
  hero: "Start",
  macro: "Macro grid",
  meso: "ERCOT",
  micro: "Home",
  vpp: "VPP",
  finale: "Recap",
};

export default function ProgressBar() {
  const progress = useGridStore((s) => s.scrollProgress);
  const xp = useGridStore((s) => s.xp);
  const badgeCount = useGridStore((s) => s.badges.size);

  return (
    <div className="pointer-events-none fixed top-0 left-0 right-0 z-30 flex items-center gap-4 px-4 py-3 sm:px-6">
      <div className="flex-1">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-400 via-emerald-400 to-livewire transition-[width] duration-150"
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </div>
        <div className="mt-1 hidden justify-between text-[10px] uppercase tracking-wide text-slate-500 sm:flex">
          {CHAPTER_BOUNDS.map((b) => (
            <span key={b.id}>{LABELS[b.id]}</span>
          ))}
        </div>
      </div>
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-xs font-medium text-slate-200 backdrop-blur-sm">
        <span className="font-mono text-livewire">{badgeCount}/4 badges</span>
        <span className="text-slate-500">·</span>
        <span className="font-mono">{xp} XP</span>
      </div>
    </div>
  );
}
