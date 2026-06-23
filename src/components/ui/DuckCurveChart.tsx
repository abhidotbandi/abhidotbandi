import { DUCK_CURVE } from "@/data/gridFacts";

const WIDTH = 320;
const HEIGHT = 140;
const PAD = 24;

export default function DuckCurveChart() {
  const { hours, netDemandGW } = DUCK_CURVE;
  const maxV = Math.max(...netDemandGW);
  const minV = Math.min(...netDemandGW);

  const points = hours.map((h, i) => {
    const x = PAD + (h / 24) * (WIDTH - PAD * 2);
    const y =
      HEIGHT - PAD - ((netDemandGW[i] - minV) / (maxV - minV)) * (HEIGHT - PAD * 2);
    return [x, y] as const;
  });

  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  return (
    <div className="panel rounded-md border border-white/10 bg-white/5 p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-400">{DUCK_CURVE.title}</p>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="mt-3 w-full">
        <line x1={PAD} y1={HEIGHT - PAD} x2={WIDTH - PAD} y2={HEIGHT - PAD} stroke="#334155" strokeWidth={1} />
        <path d={path} fill="none" stroke="#f5a623" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {points.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={3} fill="#f5a623" />
        ))}
        {hours.map((h, i) => (
          <text key={h} x={points[i][0]} y={HEIGHT - 6} fontSize={9} fill="#64748b" textAnchor="middle">
            {h}:00
          </text>
        ))}
      </svg>
      <p className="mt-2 text-xs text-slate-500">Net demand on traditional power plants, GW, illustrative summer weekday.</p>
    </div>
  );
}
