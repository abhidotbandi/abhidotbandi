"use client";

import { useEffect } from "react";
import { BADGES, useGridStore } from "@/lib/store";

export default function BadgeToast() {
  const lastBadge = useGridStore((s) => s.lastBadge);
  const clearLastBadge = useGridStore((s) => s.clearLastBadge);

  useEffect(() => {
    if (!lastBadge) return;
    const clear = setTimeout(() => clearLastBadge(), 3200);
    return () => clearTimeout(clear);
  }, [lastBadge, clearLastBadge]);

  if (!lastBadge) return null;
  const badge = BADGES[lastBadge];

  return (
    <div
      key={lastBadge}
      className="pointer-events-none fixed top-16 right-4 z-40 w-72 animate-[badge-in_0.3s_ease-out] rounded-xl border border-amber-400/40 bg-slate-950/90 p-4 shadow-lg shadow-amber-500/10 backdrop-blur-sm sm:right-6"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-400">Badge unlocked</p>
      <p className="mt-1 text-sm font-semibold text-slate-100">{badge.title}</p>
      <p className="mt-0.5 text-xs text-slate-400">{badge.description}</p>
    </div>
  );
}
