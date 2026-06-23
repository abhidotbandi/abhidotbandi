export default function StatCallout({
  value,
  label,
  color = "#f5a623",
}: {
  value: string;
  label: string;
  color?: string;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/5 px-4 py-3">
      <p className="font-mono text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </p>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  );
}
