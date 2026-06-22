import SectionShell from "./SectionShell";
import Quiz from "@/components/ui/Quiz";
import DuckCurveChart from "@/components/ui/DuckCurveChart";
import StatCallout from "@/components/ui/StatCallout";
import { ERCOT_FACTS } from "@/data/gridFacts";
import { QUIZ_QUESTIONS } from "@/data/quiz";

export default function ChapterMeso() {
  const question = QUIZ_QUESTIONS.find((q) => q.chapter === "meso")!;

  return (
    <SectionShell id="meso" align="right">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-400">Chapter 2 · ERCOT</p>
      <h2 className="text-3xl font-bold text-slate-50 sm:text-4xl">Texas chose to go it alone</h2>
      <p className="text-slate-300">{ERCOT_FACTS.isolation}</p>

      <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-4">
        <p className="text-sm font-semibold text-rose-200">{ERCOT_FACTS.uri.title}</p>
        <p className="mt-1 text-sm text-rose-100/80">{ERCOT_FACTS.uri.detail}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCallout value="~85 GW" label="Texas record summer peak demand" color="#f5a623" />
        <StatCallout value="4.5M" label="homes lost power during Uri" color="#fb7185" />
      </div>

      <DuckCurveChart />
      <p className="text-sm text-slate-400">{ERCOT_FACTS.growth}</p>

      <Quiz question={question} />
    </SectionShell>
  );
}
