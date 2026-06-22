"use client";

import { useGridStore } from "@/lib/store";

export default function OutageSimulator() {
  const outageActive = useGridStore((s) => s.outageActive);
  const setOutageActive = useGridStore((s) => s.setOutageActive);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-400">Try it</p>
      <p className="mt-2 text-sm text-slate-300">
        Flip the grid off and watch the house in the scene. The battery and hub take over before
        the lights even flicker.
      </p>
      <button
        onClick={() => setOutageActive(!outageActive)}
        className={`mt-4 w-full rounded-lg px-4 py-3 text-sm font-semibold transition-colors ${
          outageActive
            ? "bg-rose-500/20 text-rose-200 border border-rose-400/40"
            : "bg-amber-400 text-slate-950 hover:bg-amber-300"
        }`}
      >
        {outageActive ? "Grid is down — restore power" : "Cut the grid"}
      </button>
      <p className="mt-3 text-xs text-slate-500">
        {outageActive
          ? "Backup engaged in under half a second. Your home never noticed."
          : "Everything is running on normal grid power right now."}
      </p>
    </div>
  );
}
