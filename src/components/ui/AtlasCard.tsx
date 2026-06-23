"use client";

const PILLARS = ["Make", "Move", "Store", "Sell"];

interface AtlasCardProps {
  kicker: string;
  title: string;
  body: string;
  align?: "left" | "right";
  activePillar?: number;
}

export default function AtlasCard({ kicker, title, body, align = "left", activePillar }: AtlasCardProps) {
  const sideCls = align === "right" ? "right-6 sm:right-10" : "left-6 sm:left-10";

  return (
    <div
      className={`panel pointer-events-auto absolute bottom-10 ${sideCls} w-72 rounded-md border border-white/10 bg-slate-950/80 p-4 backdrop-blur-sm`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-livewire">{kicker}</p>
      <h3 className="mt-1 text-lg font-bold leading-snug text-slate-50">{title}</h3>
      <p className="mt-2 text-sm text-slate-300">{body}</p>

      {activePillar !== undefined && (
        <div className="mt-4 flex gap-1.5">
          {PILLARS.map((p, i) => (
            <span
              key={p}
              title={p}
              className={`h-1 flex-1 rounded-full ${i === activePillar ? "bg-livewire" : "bg-white/15"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
