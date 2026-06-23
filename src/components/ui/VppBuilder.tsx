"use client";

import { useGridStore } from "@/lib/store";
import StatCallout from "./StatCallout";

const MAX_HOUSES = 12;
const AVG_CAPACITY_KWH = 37.5;
const AVG_DISCHARGE_KW = 5;

export default function VppBuilder() {
  const vppHouseCount = useGridStore((s) => s.vppHouseCount);
  const setVppHouseCount = useGridStore((s) => s.setVppHouseCount);

  const totalCapacity = vppHouseCount * AVG_CAPACITY_KWH;
  const peakShaved = vppHouseCount * AVG_DISCHARGE_KW;

  return (
    <div className="panel rounded-md border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-livewire">Build your VPP</p>
      <p className="mt-2 text-sm text-slate-300">
        Add neighbors to the block. Every battery you add joins the same pool Base dispatches into
        ERCOT.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => setVppHouseCount(Math.max(1, vppHouseCount - 1))}
          className="h-9 w-9 rounded-md border border-white/15 bg-black/30 text-lg text-slate-200 hover:border-white/30"
        >
          −
        </button>
        <span className="min-w-[3ch] text-center font-mono text-lg font-semibold text-slate-100">
          {vppHouseCount}
        </span>
        <button
          onClick={() => setVppHouseCount(Math.min(MAX_HOUSES, vppHouseCount + 1))}
          className="h-9 w-9 rounded-md border border-white/15 bg-black/30 text-lg text-slate-200 hover:border-white/30"
        >
          +
        </button>
        <span className="text-xs text-slate-500">homes on the block</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <StatCallout value={`${totalCapacity.toFixed(0)} kWh`} label="Pooled battery capacity" color="#39ff14" />
        <StatCallout value={`${peakShaved.toFixed(0)} kW`} label="Peak demand shaved" color="#f5a623" />
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Base is already running this at real scale: 7,000+ homes and counting in Texas alone.
      </p>
    </div>
  );
}
