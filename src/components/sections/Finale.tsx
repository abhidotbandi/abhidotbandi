"use client";

import { useScroll } from "@react-three/drei";
import SectionShell from "./SectionShell";
import { BADGES, useGridStore } from "@/lib/store";
import { BASE_POWER } from "@/data/basePower";

export default function Finale() {
  const scroll = useScroll();
  const xp = useGridStore((s) => s.xp);
  const badges = useGridStore((s) => s.badges);

  const handleReplay = () => {
    scroll.el.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <SectionShell id="finale" align="center" className="max-w-2xl text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-400">Recap</p>
      <h2 className="text-3xl font-bold text-slate-50 sm:text-4xl">
        You just walked the entire grid — macro to micro.
      </h2>
      <p className="text-slate-300">
        {badges.size}/4 badges earned · {xp} XP. Base Power is making the case that the fastest,
        cheapest way to make the grid more reliable isn&apos;t a new power plant or a new
        transmission line — it&apos;s a battery in every garage, coordinated as one.
      </p>

      <div className="grid grid-cols-2 gap-2 text-left sm:grid-cols-4">
        {Object.entries(BADGES).map(([id, b]) => (
          <div
            key={id}
            className={`rounded-lg border p-2.5 text-xs ${
              badges.has(id as keyof typeof BADGES)
                ? "border-amber-400/50 bg-amber-400/10 text-amber-200"
                : "border-white/10 bg-white/5 text-slate-500"
            }`}
          >
            {b.title}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <a
          href="https://www.basepowercompany.com"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-amber-400 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-300"
        >
          See Base Power
        </a>
        <button
          onClick={handleReplay}
          className="rounded-lg border border-white/15 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:border-white/30"
        >
          Replay the journey
        </button>
      </div>

      <p className="pt-4 text-xs text-slate-600">{BASE_POWER.sourcesNote}</p>
    </SectionShell>
  );
}
